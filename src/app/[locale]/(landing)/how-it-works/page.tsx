import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getThemePage } from '@/core/theme';
import { getMetadata } from '@/shared/lib/seo';
import { DynamicPage } from '@/shared/types/blocks/landing';

export const revalidate = 3600;

export const generateMetadata = getMetadata({
  metadataKey: 'pages.how-it-works.metadata',
  canonicalUrl: '/how-it-works',
});

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.how-it-works');

  const page: DynamicPage = {
    title: t.raw('page.title'),
    sections: {
      hero: t.raw('page.sections.hero'),
      video_tutorial: t.raw('page.sections.video_tutorial'),
      how_it_works: t.raw('page.sections.how_it_works'),
    },
  };

  const Page = await getThemePage('dynamic-page');

  return <Page locale={locale} page={page} />;
}
