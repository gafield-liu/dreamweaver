/**
 * 有声书视频下载代理：通过服务端拉取视频并返回 attachment，避免直链跨域导致黑屏/无法下载。
 * GET /api/ai/audiobook-download?url=xxx
 */

import { NextRequest } from 'next/server';

import { envConfigs } from '@/config';

function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const appHost = envConfigs.app_url ? new URL(envConfigs.app_url).hostname : '';
    if (appHost && u.hostname === appHost) return true;
    if (u.hostname.endsWith('.r2.dev') || u.hostname.includes('cloudflare')) return true;
    if (process.env.NODE_ENV === 'development' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url || !isAllowedUrl(url)) {
    return new Response('Invalid or disallowed url', { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AudiobookDownload/1.0' },
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok || !res.body) {
      return new Response('Failed to fetch video', { status: 502 });
    }

    const contentType = res.headers.get('content-type') || 'video/mp4';
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment; filename="audiobook.mp4"',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e) {
    console.error('audiobook-download failed', e);
    return new Response('Download failed', { status: 502 });
  }
}
