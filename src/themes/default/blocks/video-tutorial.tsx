'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/core/i18n/navigation';
import { ScrollAnimation } from '@/shared/components/ui/scroll-animation';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

export function VideoTutorial({
  section,
  className,
}: {
  section: Section & {
    video?: { src: string; poster?: string; alt?: string };
    cta?: { title: string; url: string };
  };
  className?: string;
}) {
  const t = useTranslations('common.video');
  const video = section.video;
  const cta = section.cta as { title?: string; url?: string } | undefined;

  if (!video?.src) {
    return null;
  }

  return (
    <section
      id={section.id}
      className={cn('py-16 md:py-24', section.className, className)}
    >
      <div className="container">
        <ScrollAnimation>
          <div className="mx-auto max-w-4xl">
            <div className="mx-auto max-w-2xl text-center">
              {section.label && (
                <span className="text-primary">{section.label}</span>
              )}
              <h2 className="text-foreground mt-4 text-4xl font-semibold">
                {section.title}
              </h2>
              {section.description && (
                <p className="text-muted-foreground mt-4 text-lg text-balance">
                  {section.description}
                </p>
              )}
            </div>

            <ScrollAnimation delay={0.15}>
              <div className="mt-10 overflow-hidden rounded-2xl border bg-muted/30 shadow-lg">
                <video
                  className="aspect-video w-full"
                  src={video.src}
                  poster={video.poster}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={video.alt || section.title}
                >
                  {t('noSupport')}{' '}
                  <a href={video.src} className="text-primary underline">
                    {t('download')}
                  </a>
                </video>
              </div>
            </ScrollAnimation>

            {cta?.url && cta?.title && (
              <div className="mt-8 text-center">
                <Link
                  href={cta.url}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-medium transition-colors"
                >
                  {cta.title}
                </Link>
              </div>
            )}
          </div>
        </ScrollAnimation>
      </div>
    </section>
  );
}
