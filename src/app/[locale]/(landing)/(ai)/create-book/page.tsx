import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Suspense } from 'react';

import { getThemePage } from '@/core/theme';
import { CreateBookWizard } from '@/shared/blocks/generator';
import { getMetadata } from '@/shared/lib/seo';
import { DynamicPage } from '@/shared/types/blocks/landing';

export const revalidate = 3600;

export const generateMetadata = getMetadata({
  metadataKey: 'pages.create-book.metadata',
  canonicalUrl: '/create-book',
});

export default async function CreateBookPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pages.create-book');

  const page: DynamicPage = {
    sections: {
      hero: {
        title: t.raw('page.title'),
        description: t.raw('page.description'),
        background_image: {
          src: '/imgs/bg/tree.jpg',
          alt: 'hero background',
        },
      },
      generator: {
        component: (
          <Suspense fallback={<div className="mx-auto max-w-2xl px-4 py-12 text-center text-muted-foreground">Loading…</div>}>
            <CreateBookWizard />
          </Suspense>
        ),
      },
    },
  };

  const Page = await getThemePage('dynamic-page');

  return <Page locale={locale} page={page} />;
}
