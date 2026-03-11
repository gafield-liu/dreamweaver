import type { MetadataRoute } from 'next';

import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';

const BASE = envConfigs.app_url || 'https://aiaudiotools.shop';

// 需要被收录的主要落地页（不含 locale 前缀的 path）
const LANDING_PATHS = [
  '',
  '/create-book',
  '/how-it-works',
  '/pricing',
  '/showcases',
  '/blog',
  '/updates',
];

function buildUrl(path: string, locale: string): string {
  const segment = path || '/';
  if (locale === defaultLocale) {
    return segment === '/' ? BASE : `${BASE}${segment}`;
  }
  const localePath = segment === '/' ? `/${locale}` : `/${locale}${segment}`;
  return `${BASE}${localePath}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastmod = new Date().toISOString();
  const entries: MetadataRoute.Sitemap = [];

  for (const path of LANDING_PATHS) {
    for (const locale of locales) {
      entries.push({
        url: buildUrl(path, locale),
        lastModified: lastmod,
        changeFrequency: path === '' ? 'weekly' : 'monthly',
        priority: path === '' ? 1 : 0.8,
      });
    }
  }

  return entries;
}
