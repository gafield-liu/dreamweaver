/**
 * 有声书合成：将时长对齐的无声视频与 TTS 音频合并，只输出一条带音频的视频文件。
 * - 音频长于视频：循环视频直至与音频等长。
 * - 音频短于视频：截断视频至音频长度。
 * 需要服务器安装 ffmpeg 与 ffprobe。
 * 注意：为避免 HTTPS 长时间读取导致 TLS “End of file”，会先将视频/音频下载到本地再合并。
 */

import { spawnSync } from 'child_process';
import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { getUuid } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { consumeCredits, getRemainingCredits } from '@/shared/models/credit';
import { getUserInfo } from '@/shared/models/user';
import { getStorageService } from '@/shared/services/storage';
import { envConfigs } from '@/config';

const MERGE_CREDITS_COST = 4;

function resolveUrl(url: string): string {
  if (!url || url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = (envConfigs.app_url || '').replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

/** 将 URL 下载到本地文件，避免 ffmpeg 长时间读 HTTPS 导致 TLS 断开。
 * 使用重试 + 可选 undici 更长连接超时，应对 R2/Cloudflare 的 ECONNRESET 或 Connect Timeout。 */
async function downloadToFile(url: string, localPath: string): Promise<void> {
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

function getDurationSeconds(pathOrUrl: string): number {
  try {
    const r = spawnSync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        pathOrUrl,
      ],
      { encoding: 'utf-8', timeout: 30000 }
    );
    if (r.status !== 0 || r.error) return 0;
    const d = parseFloat(String(r.stdout || '').trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
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
  if (videoDuration < audioDuration) {
    const r = spawnSync('ffmpeg', [
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
    const r = spawnSync('ffmpeg', [
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

    const { getRemainingCredits } = await import('@/shared/models/credit');
    const remaining = await getRemainingCredits(user.id);
    if (remaining < MERGE_CREDITS_COST) {
      return respErr('Insufficient credits for audiobook merge');
    }

    await consumeCredits({
      userId: user.id,
      credits: MERGE_CREDITS_COST,
      scene: 'create-book-merge',
      description: 'merge video and audio for audiobook',
    });

    videoUrl = resolveUrl(videoUrl);
    audioUrl = resolveUrl(audioUrl);

    try {
      const v = spawnSync('ffmpeg', ['-version'], { encoding: 'utf-8', timeout: 2000 });
      if (v.status !== 0 && v.error) throw new Error('ffmpeg not found');
    } catch {
      return respErr('ffmpeg is not available on this server');
    }

    tmpDir = mkdtempSync(join(tmpdir(), 'merge-'));
    const outputPath = join(tmpDir, `merged-${getUuid()}.mp4`);

    // 先下载到本地，避免 ffmpeg 长时间读 HTTPS 出现 TLS "End of file"
    const videoPath = join(tmpDir, `video-${getUuid()}.mp4`);
    const audioPath = join(tmpDir, `audio-${getUuid()}.mp3`);
    await downloadToFile(videoUrl, videoPath);
    await downloadToFile(audioUrl, audioPath);

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
