/**
 * 无本地 ffmpeg 时（如 Vercel Serverless）：将已解析的绝对 URL 交给独立 Worker，
 * Worker 下载、ffmpeg 合成、上传对象存储后返回 { url }。
 *
 * Vercel 环境变量：
 * - MERGE_VIDEO_AUDIO_WORKER_URL：Worker 的完整 POST 地址，例如 https://merge.example.com/merge
 * - MERGE_VIDEO_AUDIO_WORKER_SECRET：可选；若设置则随请求发送 Authorization: Bearer <secret>
 */
export async function mergeViaRemoteWorker(videoUrl: string, audioUrl: string): Promise<string> {
  const endpoint = process.env.MERGE_VIDEO_AUDIO_WORKER_URL?.trim();
  if (!endpoint) {
    throw new Error('MERGE_VIDEO_AUDIO_WORKER_URL is not configured');
  }
  const secret = process.env.MERGE_VIDEO_AUDIO_WORKER_SECRET?.trim();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ videoUrl, audioUrl }),
    signal: AbortSignal.timeout(600_000),
  });
  const text = await res.text();
  let parsed: { url?: string; error?: string };
  try {
    parsed = JSON.parse(text) as { url?: string; error?: string };
  } catch {
    throw new Error(
      res.ok
        ? `Worker returned invalid JSON: ${text.slice(0, 240)}`
        : `Worker HTTP ${res.status}: ${text.slice(0, 240)}`
    );
  }
  if (!res.ok || typeof parsed.url !== 'string' || !parsed.url) {
    throw new Error(parsed.error || `Worker failed (${res.status})`);
  }
  return parsed.url;
}
