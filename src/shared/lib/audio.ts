/**
 * 获取音频时长（供 TTS 等按时长计费使用）。
 * 使用 ffprobe；若需从 URL 获取则先下载到临时文件再解析。
 */

import { spawnSync } from 'child_process';
import { createWriteStream, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  try {
    const p = require('@ffprobe-installer/ffprobe') as { path: string };
    if (p?.path) return p.path;
  } catch {
    // optional dependency not installed
  }
  return 'ffprobe';
}

/**
 * 从本地文件路径获取音频/视频时长（秒）。
 */
export function getDurationSeconds(path: string): number {
  try {
    const r = spawnSync(
      getFfprobePath(),
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        path,
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

/**
 * 从音频 URL 下载到临时文件并返回时长（秒）。调用方需确保可访问该 URL。
 */
export async function getAudioDurationFromUrl(audioUrl: string): Promise<number> {
  let tmpDir: string | null = null;
  try {
    const res = await fetch(audioUrl, { signal: AbortSignal.timeout(120000) });
    if (!res.ok || !res.body) return 0;
    tmpDir = mkdtempSync(join(tmpdir(), 'tts-duration-'));
    const localPath = join(tmpDir, 'audio.mp3');
    const dest = createWriteStream(localPath);
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      dest
    );
    return getDurationSeconds(localPath);
  } catch {
    return 0;
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
