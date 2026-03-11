'use client';

import { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useRouter } from '@/core/i18n/navigation';
import { useLocale } from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';
import { useAppContext } from '@/shared/contexts/app';
import { cn } from '@/shared/lib/utils';

const DEFAULT_STORY_MODEL = 'google/gemini-2.0-flash-001';

interface StoryGeneratorProps {
  srOnlyTitle?: string;
  className?: string;
}

export function StoryGenerator({ className, srOnlyTitle }: StoryGeneratorProps) {
  const t = useTranslations('ai.story');
  const locale = useLocale();
  const router = useRouter();
  const { user, setIsShowSignModal } = useAppContext();

  const [keywords, setKeywords] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitted' | 'error'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = keywords.trim();
    if (!trimmed) {
      toast.error(t('generator.keywords_required'));
      return;
    }
    if (!user) {
      setIsShowSignModal(true);
      return;
    }

    setStatus('submitted');
    try {
      const messageText = t('generator.prompt_prefix', { keywords: trimmed });
      const resp = await fetch('/api/chat/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { text: messageText },
          body: { model: DEFAULT_STORY_MODEL },
        }),
      });
      if (!resp.ok) {
        throw new Error(`request failed with status: ${resp.status}`);
      }
      const { code, message, data } = await resp.json();
      if (code !== 0 || !data?.id) {
        throw new Error(message || 'Failed to create chat');
      }
      router.push(`/chat/${data.id}`, { locale });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('generator.generate_failed');
      setStatus('error');
      toast.error(msg);
    }
  };

  return (
    <section
      className={cn('mx-auto max-w-2xl px-4 py-8 md:py-12', className)}
      aria-labelledby={srOnlyTitle ? 'story-generator-title' : undefined}
    >
      {srOnlyTitle && (
        <h2 id="story-generator-title" className="sr-only">
          {srOnlyTitle}
        </h2>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-5" aria-hidden />
            {t('generator.title')}
          </CardTitle>
          <CardDescription>{t('generator.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="story-keywords">{t('generator.keywords_label')}</Label>
              <Textarea
                id="story-keywords"
                placeholder={t('generator.keywords_placeholder')}
                value={keywords}
                onChange={(e) => {
                  setKeywords(e.target.value);
                  if (status === 'error') setStatus('idle');
                }}
                rows={3}
                className="resize-none"
                disabled={status === 'submitted'}
              />
            </div>
            <Button
              type="submit"
              disabled={status === 'submitted'}
              className="w-full sm:w-auto"
            >
              {status === 'submitted' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  {t('generator.generating')}
                </>
              ) : (
                t('generator.generate')
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
