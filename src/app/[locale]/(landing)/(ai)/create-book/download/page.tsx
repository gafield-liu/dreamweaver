'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

function DownloadContent() {
  const t = useTranslations('pages.create-book.wizard');
  const searchParams = useSearchParams();
  const videoUrl = searchParams.get('url');
  const apiDownloadUrl = videoUrl
    ? `/api/ai/audiobook-download?url=${encodeURIComponent(videoUrl)}`
    : null;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-12">
      <div className="flex flex-col items-center gap-6 rounded-2xl border bg-card p-8 shadow-lg">
        <h1 className="text-xl font-semibold text-foreground md:text-2xl">
          {t('audiobook.download_page_title')}
        </h1>
        <p className="text-center text-muted-foreground text-sm">
          {t('audiobook.download_page_description')}
        </p>
        {apiDownloadUrl ? (
          <Button asChild size="lg" className="gap-2">
            <a href={apiDownloadUrl}>
              <Download className="size-5" />
              {t('audiobook.download_page_button')}
            </a>
          </Button>
        ) : (
          <p className="text-destructive text-sm">Missing video URL.</p>
        )}
      </div>
    </div>
  );
}

export default function CreateBookDownloadPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">Loading…</div>}>
      <DownloadContent />
    </Suspense>
  );
}
