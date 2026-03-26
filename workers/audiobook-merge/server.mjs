/**
 * 有声书 ffmpeg 合成 Worker：POST JSON { videoUrl, audioUrl } → 下载、合并、上传 R2，返回 { url }。
 * 与主站 MERGE_VIDEO_AUDIO_WORKER_SECRET 对应的环境变量：WORKER_SECRET（可选）。
 */
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';

/** 降低 Docker/部分网络下 IPv6 解析导致的不稳定连接 */
setDefaultResultOrder('ipv4first');

const PORT = Number(process.env.PORT || 8080);
const WORKER_SECRET = process.env.WORKER_SECRET?.trim();

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_UPLOAD_PATH = (process.env.R2_UPLOAD_PATH || 'uploads').replace(/^\/+|\/+$/g, '');
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN?.replace(/\/+$/, '') || '';
const R2_ENDPOINT =
  process.env.R2_ENDPOINT?.trim() || (R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');

/**
 * 默认返回 S3 预签名 GET（指向 R2 API 域名，桶可私有，不依赖可公网解析的自定义域如 r2.xxx.com）。
 * 设为 0 / false 时改用下方 R2_PUBLIC_DOMAIN 或 objectUrl（需对象真正可匿名访问）。
 */
const MERGE_RETURN_PRESIGNED_URL = !['0', 'false', 'no'].includes(
  (process.env.MERGE_RETURN_PRESIGNED_URL ?? '1').trim().toLowerCase()
);
const MERGE_PRESIGNED_EXPIRES_SECONDS = Math.min(
  604800,
  Math.max(60, Number.parseInt(process.env.MERGE_PRESIGNED_EXPIRES_SECONDS || '604800', 10) || 604800)
);

/**
 * 若后台「公开域名」在 Docker/内网无法解析（ENOTFOUND），可在此列出 host，下载时改为
 * `${R2_ENDPOINT}/${R2_BUCKET_NAME}/<path>`；下载时再用 R2 密钥做签名 GET（匿名访问 S3 API 会 400）。
 * 例：-e MERGE_DOWNLOAD_REWRITE_HOSTS=r2.storycreater.com
 *
 * `*.r2.dev`（如 pub-xxx.r2.dev）默认也会重写：私有桶或未开匿名读时，直接 curl 公开链常 404/403，
 * 走 S3 签名 GET 可拉取（需已配置 R2 密钥，与上传相同）。
 * 若确需只走匿名 HTTP，可设 MERGE_REWRITE_R2_DEV=0。
 */
const MERGE_DOWNLOAD_REWRITE_HOSTS = (process.env.MERGE_DOWNLOAD_REWRITE_HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const MERGE_REWRITE_R2_DEV = !['0', 'false', 'no'].includes(
  (process.env.MERGE_REWRITE_R2_DEV ?? '1').trim().toLowerCase()
);

function isR2DevPublicHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === 'r2.dev' || h.endsWith('.r2.dev');
}

function rewriteDownloadUrl(url) {
  if (!R2_ENDPOINT || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return url;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const manual = MERGE_DOWNLOAD_REWRITE_HOSTS.includes(h);
    const r2dev = MERGE_REWRITE_R2_DEV && isR2DevPublicHostname(h);
    if (!manual && !r2dev) return url;
    const path = u.pathname.replace(/^\/+/, '');
    if (!path) return url;
    return `${R2_ENDPOINT}/${R2_BUCKET_NAME}/${path}`;
  } catch {
    return url;
  }
}

/** 是否为当前桶在本仓库 R2 S3 API 上的对象 URL（需签名 GET，不能匿名 curl） */
function isOurR2ObjectUrl(url) {
  if (!R2_ENDPOINT || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return false;
  try {
    const u = new URL(url);
    const ep = new URL(R2_ENDPOINT);
    if (u.origin !== ep.origin) return false;
    const prefix = `/${R2_BUCKET_NAME}/`;
    return u.pathname.startsWith(prefix) && u.pathname.length > prefix.length;
  } catch {
    return false;
  }
}

async function downloadViaR2Signed(url, localPath) {
  const { AwsClient } = await import('aws4fetch');
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: 'auto',
  });
  const res = await client.fetch(new Request(url, { method: 'GET' }));
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`R2 GET ${res.status}${detail ? ` — ${detail.slice(0, 400)}` : ''}`);
  }
  const dest = createWriteStream(localPath);
  await pipeline(Readable.fromWeb(res.body), dest);
}

/** 把 undici/aws4fetch 的 “fetch failed” 展开为可读原因（含 ECONNRESET、ETIMEDOUT 等） */
function serializeError(err) {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let c = err.cause;
  let depth = 0;
  while (c && depth++ < 5) {
    if (c instanceof Error) {
      parts.push(c.message);
      const code = 'code' in c ? String(/** @type {{ code?: string }} */ (c).code || '') : '';
      if (code) parts.push(`code=${code}`);
      c = c.cause;
    } else {
      parts.push(String(c));
      break;
    }
  }
  return parts.join(' ← ');
}

function parseDurationFromFfprobeJson(stdout) {
  try {
    const j = JSON.parse(stdout);
    const fd = j.format?.duration;
    if (fd) {
      const d = parseFloat(fd);
      if (Number.isFinite(d) && d > 0) return d;
    }
    for (const s of j.streams || []) {
      if (s.codec_type === 'audio' && s.duration) {
        const d = parseFloat(s.duration);
        if (Number.isFinite(d) && d > 0) return d;
      }
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function parseDurationFromFfmpegStderr(stderr) {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  if (!Number.isFinite(h + min + sec)) return 0;
  const d = h * 3600 + min * 60 + sec;
  return d > 0 ? d : 0;
}

function getDurationSeconds(pathOrUrl) {
  try {
    const r = spawnSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        '-analyzeduration',
        '100M',
        '-probesize',
        '100M',
        pathOrUrl,
      ],
      { encoding: 'utf-8', timeout: 60000 }
    );
    if (r.status === 0 && !r.error) {
      const d = parseDurationFromFfprobeJson(String(r.stdout || ''));
      if (d > 0) return d;
    }
  } catch {
    /* fall through */
  }

  try {
    const r = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', pathOrUrl],
      { encoding: 'utf-8', timeout: 30000 }
    );
    if (r.status === 0 && !r.error) {
      const d = parseFloat(String(r.stdout || '').trim());
      if (Number.isFinite(d) && d > 0) return d;
    }
  } catch {
    /* fall through */
  }

  try {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', pathOrUrl, '-f', 'null', '-'], {
      encoding: 'utf-8',
      timeout: 120000,
    });
    const d = parseDurationFromFfmpegStderr(String(r.stderr || ''));
    if (d > 0) return d;
  } catch {
    /* ignore */
  }
  return 0;
}

/** 对 R2 对象 URL 生成预签名 GET，供浏览器 <video src> 播放（私有桶也可用）。 */
async function presignedGetUrl(objectUrl) {
  const { AwsClient } = await import('aws4fetch');
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: 'auto',
  });
  const u = new URL(objectUrl);
  u.searchParams.set('X-Amz-Expires', String(MERGE_PRESIGNED_EXPIRES_SECONDS));
  const signed = await client.sign(u.toString(), {
    method: 'GET',
    aws: { signQuery: true, region: 'auto', service: 's3' },
  });
  return signed.url.toString();
}

/** 长超时 + 多策略：undici → 重试 → curl（国内/不稳定网络下 r2.dev 等常出现 ConnectTimeout / ECONNRESET） */
async function downloadWithUndici(url, localPath) {
  const bodyTimeoutMs = 300000;
  const { fetch: undiciFetch, Agent } = await import('undici');
  const dispatcher = new Agent({
    connectTimeout: 180000,
    bodyTimeout: bodyTimeoutMs,
    headersTimeout: 180000,
  });
  const res = await undiciFetch(url, {
    signal: AbortSignal.timeout(bodyTimeoutMs),
    dispatcher,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const dest = createWriteStream(localPath);
  await pipeline(Readable.fromWeb(res.body), dest);
}

function downloadWithCurl(url, localPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      'curl',
      [
        '-fL',
        '-sS',
        '--connect-timeout',
        '180',
        '--max-time',
        '600',
        '-o',
        localPath,
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let err = '';
    p.stderr?.on('data', (c) => {
      err += c.toString();
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().slice(0, 500) || `curl exit ${code}`));
    });
  });
}

async function downloadToFile(url, localPath) {
  if (isOurR2ObjectUrl(url)) {
    const parts = [];
    const maxSigned = 3;
    for (let attempt = 1; attempt <= maxSigned; attempt++) {
      try {
        await downloadViaR2Signed(url, localPath);
        return;
      } catch (e) {
        parts.push(`r2-signed#${attempt}: ${serializeError(e)}`);
        if (attempt < maxSigned) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw new Error(`Download failed (${url.slice(0, 96)}…) — ${parts.join(' | ')}`);
  }

  const parts = [];
  try {
    await downloadWithCurl(url, localPath);
    return;
  } catch (e) {
    parts.push(`curl: ${serializeError(e)}`);
  }
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await downloadWithUndici(url, localPath);
      return;
    } catch (e) {
      parts.push(`undici#${attempt}: ${serializeError(e)}`);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`Download failed (${url.slice(0, 96)}…) — ${parts.join(' | ')}`);
}

function mergeVideoAudio(videoPath, audioPath, outputPath) {
  const audioDuration = getDurationSeconds(audioPath);
  const videoDuration = getDurationSeconds(videoPath);
  if (audioDuration <= 0) throw new Error('Could not get audio duration');

  const durationArg = audioDuration.toFixed(2);
  const mapVideoAudio = [
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    '-shortest',
  ];
  const opts = { encoding: 'utf-8', timeout: 600000 };

  if (videoDuration < audioDuration) {
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-stream_loop', '-1', '-i', videoPath, '-i', audioPath, '-t', durationArg, ...mapVideoAudio, outputPath],
      opts
    );
    if (r.status !== 0) {
      throw new Error([r.stderr, r.stdout].filter(Boolean).join('\n').trim() || 'ffmpeg failed');
    }
  } else {
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-i', videoPath, '-i', audioPath, '-t', durationArg, ...mapVideoAudio, outputPath],
      opts
    );
    if (r.status !== 0) {
      throw new Error([r.stderr, r.stdout].filter(Boolean).join('\n').trim() || 'ffmpeg failed');
    }
  }
}

async function uploadToR2(body, key) {
  if (!R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    throw new Error('R2 env not fully configured (R2_BUCKET_NAME, keys, endpoint)');
  }
  const { AwsClient } = await import('aws4fetch');
  const client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    region: 'auto',
  });
  const objectUrl = `${R2_ENDPOINT}/${R2_BUCKET_NAME}/${R2_UPLOAD_PATH}/${key}`;
  let lastNetErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const request = new Request(objectUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': 'inline',
          'Content-Length': String(body.length),
        },
        body,
      });
      const response = await client.fetch(request);
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `R2 upload failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 400)}` : ''}`
        );
      }
      if (MERGE_RETURN_PRESIGNED_URL) {
        return await presignedGetUrl(objectUrl);
      }
      // 自定义域（如 r2.dev / 自有域）通常已绑定桶，路径为 /uploadPath/key。
      // 若 R2_PUBLIC_DOMAIN 与 S3 API 同主机（*.r2.cloudflarestorage.com），公开访问必须与 PUT 一致含 bucket 段，否则浏览器 404、<video> 黑屏。
      let publicUrl = objectUrl;
      if (R2_PUBLIC_DOMAIN) {
        const base = R2_PUBLIC_DOMAIN.replace(/\/+$/, '');
        try {
          const pub = new URL(base);
          const ep = new URL(R2_ENDPOINT);
          if (pub.hostname === ep.hostname) {
            publicUrl = `${base}/${R2_BUCKET_NAME}/${R2_UPLOAD_PATH}/${key}`;
          } else {
            publicUrl = `${base}/${R2_UPLOAD_PATH}/${key}`;
          }
        } catch {
          publicUrl = `${base}/${R2_UPLOAD_PATH}/${key}`;
        }
      }
      return publicUrl;
    } catch (e) {
      lastNetErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (/^R2 upload failed: \d/.test(msg)) {
        throw e;
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`R2 upload network error: ${serializeError(lastNetErr)}`);
}

function json(res, status, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}

async function handleMerge(req, res) {
  let tmpDir = null;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    let videoUrl = body.videoUrl;
    let audioUrl = body.audioUrl;
    if (typeof videoUrl !== 'string' || typeof audioUrl !== 'string' || !videoUrl || !audioUrl) {
      json(res, 400, { error: 'videoUrl and audioUrl are required' });
      return;
    }
    videoUrl = rewriteDownloadUrl(videoUrl);
    audioUrl = rewriteDownloadUrl(audioUrl);

    tmpDir = mkdtempSync(join(tmpdir(), 'merge-'));
    const videoPath = join(tmpDir, `video-${randomUUID()}.mp4`);
    const audioPath = join(tmpDir, `audio-${randomUUID()}.mp3`);
    const outputPath = join(tmpDir, `merged-${randomUUID()}.mp4`);

    await downloadToFile(videoUrl, videoPath);
    await downloadToFile(audioUrl, audioPath);
    mergeVideoAudio(videoPath, audioPath, outputPath);

    const buf = readFileSync(outputPath);
    const key = `audiobook/${randomUUID()}.mp4`;
    const url = await uploadToR2(new Uint8Array(buf), key);
    json(res, 200, { url });
  } catch (e) {
    const msg = e instanceof Error ? serializeError(e) : 'Merge failed';
    console.error('worker merge error', e);
    json(res, 500, { error: msg });
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/merge') {
    json(res, 404, { error: 'Not found' });
    return;
  }

  if (WORKER_SECRET) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token !== WORKER_SECRET) {
      json(res, 401, { error: 'Unauthorized' });
      return;
    }
  }

  await handleMerge(req, res);
});

server.listen(PORT, () => {
  console.log(`audiobook-merge-worker listening on :${PORT}`);
});
