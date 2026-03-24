/**
 * 有声书合成：将时长对齐的无声视频与 TTS 音频合并，只输出一条带音频的视频文件。
 * - 音频长于视频：循环视频直至与音频等长。
 * - 音频短于视频：截断视频至音频长度。
 *
 * ffmpeg 支持方式（按优先级）：
 * 1. 环境变量 FFMPEG_PATH / FFPROBE_PATH 指定可执行文件路径
 * 2. optionalDependencies：@ffmpeg-installer/ffmpeg、@ffprobe-installer/ffprobe（Vercel 等无系统 ffmpeg 时自动使用）
 * 3. 系统 PATH 中的 ffmpeg、ffprobe（Docker/自建机可安装 ffmpeg 包）
 *
 * 读取媒体时长：优先 ffprobe，不可用时由 getDurationSeconds 回退到 ffmpeg -i，故不必强制安装 ffprobe。
 *
 * Vercel / 无 ffmpeg：设置 MERGE_VIDEO_AUDIO_WORKER_URL（及可选 MERGE_VIDEO_AUDIO_WORKER_SECRET），
 * 由独立 Worker（见仓库 workers/audiobook-merge）完成合成与上传；本路由只做鉴权、积分与转发。
 */

import { spawnSync } from 'child_process';
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { mergeViaRemoteWorker } from './remote-worker';
import { getUuid } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { consumeCredits, getRemainingCredits } from '@/shared/models/credit';
import type { Configs } from '@/shared/models/config';
import { getAllConfigs } from '@/shared/models/config';
import { getUserInfo } from '@/shared/models/user';
import { getStorageService } from '@/shared/services/storage';
import { envConfigs } from '@/config';

const MERGE_CREDITS_COST = 4;

/** 常见安装位置：Next 子进程有时拿不到带 Homebrew 的 PATH，直接探测可执行文件。 */
const FFMPEG_CANDIDATE_PATHS =
  process.platform === 'darwin'
    ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
    : process.platform === 'linux'
      ? ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
      : [];

const FFPROBE_CANDIDATE_PATHS =
  process.platform === 'darwin'
    ? ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe']
    : process.platform === 'linux'
      ? ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe']
      : [];

/** 解析 ffmpeg/ffprobe 路径：环境变量（须存在）→ npm 安装器（须存在）→ 常见路径 → PATH 中的命令名。 */
function getFfmpegPath(): string {
  const env = process.env.FFMPEG_PATH;
  if (env && existsSync(env)) return env;
  try {
    const p = require('@ffmpeg-installer/ffmpeg') as { path: string };
    if (p?.path && existsSync(p.path)) return p.path;
  } catch {
    // optional dependency not installed
  }
  for (const fp of FFMPEG_CANDIDATE_PATHS) {
    if (existsSync(fp)) return fp;
  }
  return 'ffmpeg';
}

function getFfprobePath(): string {
  const env = process.env.FFPROBE_PATH;
  if (env && existsSync(env)) return env;
  try {
    const p = require('@ffprobe-installer/ffprobe') as { path: string };
    if (p?.path && existsSync(p.path)) return p.path;
  } catch {
    // optional dependency not installed
  }
  for (const fp of FFPROBE_CANDIDATE_PATHS) {
    if (existsSync(fp)) return fp;
  }
  return 'ffprobe';
}

function resolveUrl(url: string): string {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = (envConfigs.app_url || '').replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/** 与 Worker 的 MERGE_DOWNLOAD_REWRITE_HOSTS 一致：自定义公开域在服务端不可解析时，改用 R2 S3 地址下载。需设置 MERGE_DOWNLOAD_R2_ENDPOINT + MERGE_DOWNLOAD_R2_BUCKET，或 R2_ACCOUNT_ID + R2_BUCKET_NAME。 */
function rewriteMergeDownloadUrl(url: string): string {
  const hosts = process.env.MERGE_DOWNLOAD_REWRITE_HOSTS?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!hosts?.length) return url;
  const accountId = process.env.MERGE_DOWNLOAD_R2_ACCOUNT_ID?.trim() || process.env.R2_ACCOUNT_ID?.trim();
  const endpoint =
    process.env.MERGE_DOWNLOAD_R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = process.env.MERGE_DOWNLOAD_R2_BUCKET?.trim() || process.env.R2_BUCKET_NAME?.trim();
  if (!endpoint || !bucket) return url;
  try {
    const u = new URL(url);
    if (!hosts.includes(u.hostname.toLowerCase())) return url;
    const pathOnly = u.pathname.replace(/^\/+/, '');
    if (!pathOnly) return url;
    return `${endpoint}/${bucket}/${pathOnly}`;
  } catch {
    return url;
  }
}

type R2DownloadOpts = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** 与 Worker 一致：R2 S3 API 地址匿名 GET 会 400，需用密钥签名 GET。 */
function buildR2DownloadOpts(configs: Configs): R2DownloadOpts | undefined {
  const accountId = configs.r2_account_id || process.env.R2_ACCOUNT_ID || '';
  const endpoint =
    (configs.r2_endpoint || '').trim() ||
    process.env.MERGE_DOWNLOAD_R2_ENDPOINT?.trim() ||
    process.env.R2_ENDPOINT?.trim() ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const bucket = (configs.r2_bucket_name || process.env.R2_BUCKET_NAME || '').trim();
  const accessKeyId = (configs.r2_access_key || process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (configs.r2_secret_key || process.env.R2_SECRET_ACCESS_KEY || '').trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

function isR2ApiObjectUrl(url: string, endpoint: string, bucket: string): boolean {
  try {
    const u = new URL(url);
    const ep = new URL(endpoint);
    if (u.origin !== ep.origin) return false;
    const prefix = `/${bucket}/`;
    return u.pathname.startsWith(prefix) && u.pathname.length > prefix.length;
  } catch {
    return false;
  }
}

async function downloadViaR2Signed(
  url: string,
  localPath: string,
  accessKeyId: string,
  secretAccessKey: string
): Promise<void> {
  const { AwsClient } = await import('aws4fetch');
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: 'auto',
  });
  const res = await client.fetch(new Request(url, { method: 'GET' }));
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`R2 GET ${res.status}${detail ? ` — ${detail.slice(0, 400)}` : ''}`);
  }
  const dest = createWriteStream(localPath);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), dest);
}

/** 将 URL 下载到本地文件，避免 ffmpeg 长时间读 HTTPS 导致 TLS 断开。
 * 使用重试 + 可选 undici 更长连接超时，应对 R2/Cloudflare 的 ECONNRESET 或 Connect Timeout。 */
async function downloadToFile(
  url: string,
  localPath: string,
  r2?: R2DownloadOpts
): Promise<void> {
  if (r2 && isR2ApiObjectUrl(url, r2.endpoint, r2.bucket)) {
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await downloadViaR2Signed(url, localPath, r2.accessKeyId, r2.secretAccessKey);
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    throw new Error(`Download failed after ${maxAttempts} attempts: ${err.message}`, { cause: err });
  }

  const maxAttempts = 3;
  const connectTimeoutMs = 60000;
  const bodyTimeoutMs = 300000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      let res: Response;
      try {
        // 使用 undici 可设置更长 connectTimeout，避免 UND_ERR_CONNECT_TIMEOUT（需安装 undici）
        const undici = await import(/* webpackIgnore: true */ 'undici');
        const dispatcher = new (undici as { Agent: new (o: { connectTimeout: number; bodyTimeout: number }) => unknown }).Agent({
          connectTimeout: connectTimeoutMs,
          bodyTimeout: bodyTimeoutMs,
        });
        res = await (undici as unknown as { fetch: (u: string, o?: object) => Promise<Response> }).fetch(url, {
          signal: AbortSignal.timeout(bodyTimeoutMs),
          dispatcher,
        });
      } catch {
        res = await fetch(url, { signal: AbortSignal.timeout(bodyTimeoutMs) });
      }
      if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);
      const dest = createWriteStream(localPath);
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), dest);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  throw new Error(`Download failed after ${maxAttempts} attempts: ${err.message}`, { cause: err });
}

/** 从 ffprobe JSON 中取时长：优先 format.duration，其次各音频流的 duration。 */
function parseDurationFromFfprobeJson(stdout: string): number {
  try {
    const j = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; duration?: string }>;
    };
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
    // ignore
  }
  return 0;
}

/** ffmpeg -i 的 stderr 里含 Duration: HH:MM:SS.xx */
function parseDurationFromFfmpegStderr(stderr: string): number {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  if (!Number.isFinite(h + min + sec)) return 0;
  const d = h * 3600 + min * 60 + sec;
  return d > 0 ? d : 0;
}

/**
 * 获取本地媒体文件时长（秒）。先 ffprobe JSON（大 probesize，兼容 VBR/无容器 duration），
 * 失败再用 ffmpeg -i 解析 Duration（较慢但覆盖面大）。
 */
function getDurationSeconds(pathOrUrl: string): number {
  const ffprobe = getFfprobePath();
  try {
    const r = spawnSync(
      ffprobe,
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        '-analyzeduration', '100M',
        '-probesize', '100M',
        pathOrUrl,
      ],
      { encoding: 'utf-8', timeout: 60000 }
    );
    if (r.status === 0 && !r.error) {
      const d = parseDurationFromFfprobeJson(String(r.stdout || ''));
      if (d > 0) return d;
    }
  } catch {
    // fall through
  }

  // 单行 format=duration（部分环境 JSON 异常时的补充）
  try {
    const r = spawnSync(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        pathOrUrl,
      ],
      { encoding: 'utf-8', timeout: 30000 }
    );
    if (r.status === 0 && !r.error) {
      const d = parseFloat(String(r.stdout || '').trim());
      if (Number.isFinite(d) && d > 0) return d;
    }
  } catch {
    // fall through
  }

  try {
    const ffmpegPath = getFfmpegPath();
    const r = spawnSync(
      ffmpegPath,
      ['-hide_banner', '-nostats', '-i', pathOrUrl, '-f', 'null', '-'],
      { encoding: 'utf-8', timeout: 120000 }
    );
    const err = String(r.stderr || '');
    const d = parseDurationFromFfmpegStderr(err);
    if (d > 0) return d;
  } catch {
    // ignore
  }

  return 0;
}

function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): void {
  const audioDuration = getDurationSeconds(audioPath);
  const videoDuration = getDurationSeconds(videoPath);

  if (audioDuration <= 0) {
    throw new Error('Could not get audio duration');
  }

  const durationArg = audioDuration.toFixed(2);

  // 只输出一条带音频的视频：取输入0的视频流、输入1的音频流，不包含视频自带的音轨
  // -movflags +faststart：将元数据移到文件头，便于浏览器边下边播，减少卡顿
  const mapVideoAudio = [
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-shortest',
  ];

  const opts = { encoding: 'utf-8' as const, timeout: 600000 }; // 10 分钟
  const ffmpegPath = getFfmpegPath();
  if (videoDuration < audioDuration) {
    const r = spawnSync(ffmpegPath, [
      '-y', '-stream_loop', '-1', '-i', videoPath,
      '-i', audioPath, '-t', durationArg,
      ...mapVideoAudio,
      outputPath,
    ], opts);
    if (r.status !== 0) {
      const err = [r.stderr, r.stdout].filter(Boolean).join('\n').trim() || 'ffmpeg failed';
      throw new Error(err);
    }
  } else {
    const r = spawnSync(ffmpegPath, [
      '-y', '-i', videoPath, '-i', audioPath,
      '-t', durationArg,
      ...mapVideoAudio,
      outputPath,
    ], opts);
    if (r.status !== 0) {
      const err = [r.stderr, r.stdout].filter(Boolean).join('\n').trim() || 'ffmpeg failed';
      throw new Error(err);
    }
  }
}

export async function POST(request: Request) {
  let tmpDir: string | null = null;
  try {
    const payload = await request.json();
    let { videoUrl, audioUrl } = payload as { videoUrl?: string; audioUrl?: string };
    if (!videoUrl || !audioUrl || typeof videoUrl !== 'string' || typeof audioUrl !== 'string') {
      return respErr('videoUrl and audioUrl are required');
    }

    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const remaining = await getRemainingCredits(user.id);
    if (remaining < MERGE_CREDITS_COST) {
      return respErr('Insufficient credits for audiobook merge');
    }

    videoUrl = resolveUrl(videoUrl);
    audioUrl = resolveUrl(audioUrl);
    videoUrl = rewriteMergeDownloadUrl(videoUrl);
    audioUrl = rewriteMergeDownloadUrl(audioUrl);

    const configs = await getAllConfigs();
    const r2Download = buildR2DownloadOpts(configs);

    const workerEndpoint = process.env.MERGE_VIDEO_AUDIO_WORKER_URL?.trim();
    if (workerEndpoint) {
      try {
        const mergedUrl = await mergeViaRemoteWorker(videoUrl, audioUrl);
        await consumeCredits({
          userId: user.id,
          credits: MERGE_CREDITS_COST,
          scene: 'create-book-merge',
          description: 'merge video and audio for audiobook (remote worker)',
        });
        return respData({ url: mergedUrl });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Remote worker merge failed';
        console.error('merge-video-audio remote worker failed', e);
        return respErr(msg);
      }
    }

    const ffmpegPath = getFfmpegPath();
    try {
      const v = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf-8', timeout: 15000 });
      if (v.error || v.status !== 0) throw new Error('ffmpeg not found');
    } catch {
      return respErr(
        'ffmpeg is not available on this server. Local: install ffmpeg (e.g. brew install ffmpeg) or set FFMPEG_PATH. Vercel: set MERGE_VIDEO_AUDIO_WORKER_URL to a Docker worker (see workers/audiobook-merge).'
      );
    }

    await consumeCredits({
      userId: user.id,
      credits: MERGE_CREDITS_COST,
      scene: 'create-book-merge',
      description: 'merge video and audio for audiobook',
    });

    tmpDir = mkdtempSync(join(tmpdir(), 'merge-'));
    const outputPath = join(tmpDir, `merged-${getUuid()}.mp4`);

    // 先下载到本地，避免 ffmpeg 长时间读 HTTPS 出现 TLS "End of file"
    const videoPath = join(tmpDir, `video-${getUuid()}.mp4`);
    const audioPath = join(tmpDir, `audio-${getUuid()}.mp3`);
    await downloadToFile(videoUrl, videoPath, r2Download);
    await downloadToFile(audioUrl, audioPath, r2Download);

    mergeVideoAudio(videoPath, audioPath, outputPath);

    const body = new Uint8Array(readFileSync(outputPath));
    const storage = await getStorageService();
    const key = `audiobook/${getUuid()}.mp4`;
    const result = await storage.uploadFile({
      body,
      key,
      contentType: 'video/mp4',
      disposition: 'inline',
    });

    if (!result.success || !result.url) {
      return respErr(result.error || 'Upload failed');
    }

    return respData({ url: result.url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Merge failed';
    console.error('merge-video-audio failed', e);
    return respErr(msg);
  } finally {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
