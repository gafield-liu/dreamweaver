'use client';

import { ArrowRight, ImageIcon, BookOpen, Mic } from 'lucide-react';
import { Link } from '@/core/i18n/navigation';
import { SmartIcon } from '@/shared/blocks/common/smart-icon';
import { ScrollAnimation } from '@/shared/components/ui/scroll-animation';
import { cn } from '@/shared/lib/utils';
import { Section } from '@/shared/types/blocks/landing';

const STEP_ICONS: Record<number, React.ComponentType<{ className?: string }>> = {
  1: ImageIcon,
  2: BookOpen,
  3: Mic,
};

export function HowItWorks({
  section,
  className,
}: {
  section: Section;
  className?: string;
}) {
  return (
    <section
      id={section.id}
      className={cn('py-16 md:py-24', section.className, className)}
    >
      <div className="container">
        <ScrollAnimation>
          <div className="mx-auto max-w-2xl text-center">
            {section.label && (
              <span className="text-primary">{section.label}</span>
            )}
            <h2 className="text-foreground mt-4 text-4xl font-semibold">
              {section.title}
            </h2>
            <p className="text-muted-foreground mt-4 text-lg text-balance">
              {section.description}
            </p>
            {(section as any).primary_cta?.url && (
              <div className="mt-6">
                <Link
                  href={(section as any).primary_cta.url}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-6 py-3 font-medium transition-colors"
                >
                  {(section as any).primary_cta.title}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            )}
          </div>
        </ScrollAnimation>

        <ScrollAnimation delay={0.2}>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {section.items?.map((item: any, idx: number) => {
              const stepNum = idx + 1;
              const IconComponent = STEP_ICONS[stepNum] || SmartIcon;
              const content = (
                <>
                  <div className="bg-muted/50 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border">
                    {item.image?.src ? (
                      <img
                        src={item.image.src}
                        alt={item.image.alt || item.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        {item.icon ? (
                          <SmartIcon
                            name={item.icon as string}
                            size={48}
                            className="opacity-80"
                          />
                        ) : (
                          <IconComponent className="h-12 w-12 opacity-60" />
                        )}
                        <span className="text-xs font-medium">
                          Step {stepNum}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-4">
                    <span className="text-primary text-sm font-medium">
                      Step {stepNum}
                    </span>
                    <h3 className="text-foreground mt-1 text-lg font-semibold">
                      {item.title}
                    </h3>
                    <p className="text-muted-foreground mt-2 text-balance text-sm">
                      {item.description}
                    </p>
                    {item.url && (
                      <span className="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium">
                        {item.cta || 'Try it'}
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </div>
                </>
              );

              if (item.url) {
                return (
                  <Link
                    key={idx}
                    href={item.url}
                    className={cn(
                      'group block rounded-2xl border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg',
                      item.className
                    )}
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div
                  key={idx}
                  className={cn(
                    'rounded-2xl border bg-card p-6',
                    item.className
                  )}
                >
                  {content}
                </div>
              );
            })}
          </div>
        </ScrollAnimation>
      </div>
    </section>
  );
}
