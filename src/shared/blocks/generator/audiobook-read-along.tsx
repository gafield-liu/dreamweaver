'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw, Volume2, Download } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';

import { LazyImage } from '@/shared/blocks/common';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';

function splitParagraphs(text: string): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function AudiobookReadAlong({
  characterImageUrl,
  characterIsVideo = false,
  storyText,
  ttsAudioUrl,
  autoPlay = true,
  className,
  remainingCredits,
  onCreditsRefresh,
}: {
  characterImageUrl: string;
  characterIsVideo?: boolean;
  storyText: string;
  ttsAudioUrl: string;
  autoPlay?: boolean;
  className?: string;
  /** Remaining credits; merge is skipped when < 4. */
  remainingCredits?: number;
  onCreditsRefresh?: () => void;
}) {
  const t = useTranslations('pages.create-book.wizard');
  const locale = useLocale();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mergedVideoRef = useRef<HTMLVideoElement>(null);
  const onCreditsRefreshRef = useRef(onCreditsRefresh);
  onCreditsRefreshRef.current = onCreditsRefresh;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const [mergedVideoUrl, setMergedVideoUrl] = useState<string | null>(null);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeRetryKey, setMergeRetryKey] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioReady, setAudioReady] = useState(false);

  const paragraphs = splitParagraphs(storyText);
  const totalChars = paragraphs.join('').length;
  const charCountUpTo = paragraphs.reduce<number[]>((acc, p) => {
    const prev = acc.length ? acc[acc.length - 1]! : 0;
    acc.push(prev + p.length);
    return acc;
  }, []);

  const activeIndex =
    duration > 0 && totalChars > 0 && charCountUpTo.length > 0
      ? (() => {
          const idx = charCountUpTo.findIndex(
            (c) => c >= (currentTime / duration) * totalChars
          );
          return idx >= 0 ? idx : paragraphs.length - 1;
        })()
      : 0;
  const safeActiveIndex = Math.min(Math.max(0, activeIndex), paragraphs.length - 1);

  const useMerged = Boolean(mergedVideoUrl);

  const handlePlayPause = useCallback(() => {
    if (useMerged) {
      const video = mergedVideoRef.current;
      if (!video) return;
      if (video.paused) {
        video.play().catch(() => {});
        setIsPlaying(true);
      } else {
        video.pause();
        setIsPlaying(false);
      }
      return;
    }
    if (characterIsVideo) {
      const video = videoRef.current;
      if (video) {
        if (video.paused) {
          video.play().catch(() => {});
          setIsPlaying(true);
        } else {
          video.pause();
          setIsPlaying(false);
        }
      }
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [characterIsVideo, useMerged]);

  const handleTimeUpdate = useCallback(() => {
    if (useMerged) {
      const video = mergedVideoRef.current;
      if (video) setCurrentTime(video.currentTime);
      return;
    }
    if (characterIsVideo) {
      const video = videoRef.current;
      if (video) setCurrentTime(video.currentTime);
      return;
    }
    const audio = audioRef.current;
    if (audio) setCurrentTime(audio.currentTime);
  }, [characterIsVideo, useMerged]);

  const handleLoadedMetadata = useCallback(() => {
    if (useMerged) {
      const video = mergedVideoRef.current;
      if (video) {
        setDuration(video.duration);
        setAudioReady(true);
      }
      return;
    }
    if (characterIsVideo) {
      const video = videoRef.current;
      if (video && video.duration && isFinite(video.duration)) {
        setDuration(video.duration);
        setAudioReady(true);
      }
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      setDuration(audio.duration);
      setAudioReady(true);
    }
  }, [characterIsVideo, useMerged]);

  const handleEnded = useCallback(() => {
    if (useMerged) {
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }
    if (characterIsVideo) {
      // 静音循环视频不会触发 ended，忽略
      return;
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, [useMerged]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (isNaN(v)) return;
    setCurrentTime(v);
    if (useMerged) {
      const video = mergedVideoRef.current;
      if (video) video.currentTime = v;
      return;
    }
    if (characterIsVideo) {
      const video = videoRef.current;
      if (video) video.currentTime = v;
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = v;
      setCurrentTime(v);
    }
  }, [characterIsVideo, useMerged]);

  useEffect(() => {
    if (!characterIsVideo || !ttsAudioUrl || !characterImageUrl) return;
    if (remainingCredits != null && remainingCredits < 4) {
      setMergeError('insufficient_credits_for_merge');
      setMergeLoading(false);
      return;
    }
    setMergeLoading(true);
    setMergeError(null);
    fetch('/api/ai/merge-video-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: characterImageUrl,
        audioUrl: ttsAudioUrl,
      }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.code === 0 && res.data?.url) {
          setMergedVideoUrl(res.data.url);
          setMergeError(null);
          onCreditsRefreshRef.current?.();
        } else {
          setMergeError(res.message || 'Merge failed');
        }
      })
      .catch(() => setMergeError('Merge request failed'))
      .finally(() => setMergeLoading(false));
    // 不把 remainingCredits / onCreditsRefresh 放进依赖：合成成功后会 refresh 积分，若依赖积分会再次触发 effect，造成重复请求与重复扣费。
  }, [characterIsVideo, ttsAudioUrl, characterImageUrl, mergeRetryKey]);

  const handleMergeRetry = useCallback(() => {
    setMergeError(null);
    setMergedVideoUrl(null);
    setMergeRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const media = useMerged
      ? mergedVideoRef.current
      : characterIsVideo
        ? videoRef.current
        : audioRef.current;
    if (!media) return;
    media.addEventListener('timeupdate', handleTimeUpdate);
    media.addEventListener('loadedmetadata', handleLoadedMetadata);
    media.addEventListener('ended', handleEnded);
    return () => {
      media.removeEventListener('timeupdate', handleTimeUpdate);
      media.removeEventListener('loadedmetadata', handleLoadedMetadata);
      media.removeEventListener('ended', handleEnded);
    };
  }, [handleTimeUpdate, handleLoadedMetadata, handleEnded, useMerged, characterIsVideo]);

  useEffect(() => {
    const el = paragraphRefs.current[safeActiveIndex];
    const container = scrollContainerRef.current;
    if (el && container) {
      const offset = el.offsetTop - container.offsetTop;
      const scrollTarget = offset - container.clientHeight / 2 + el.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
    }
  }, [safeActiveIndex]);

  useEffect(() => {
    if (!autoPlay || !audioReady) return;
    if (useMerged) {
      const video = mergedVideoRef.current;
      const tid = setTimeout(() => {
        video?.play().catch(() => {});
        setIsPlaying(true);
      }, 400);
      return () => clearTimeout(tid);
    }
    if (characterIsVideo) {
      const video = videoRef.current;
      const tid = setTimeout(() => {
        video?.play().catch(() => {});
        setIsPlaying(true);
      }, 400);
      return () => clearTimeout(tid);
    }
    const audio = audioRef.current;
    const tid = setTimeout(() => {
      audio?.play().catch(() => {});
      setIsPlaying(true);
    }, 400);
    return () => clearTimeout(tid);
  }, [autoPlay, audioReady, characterIsVideo, useMerged]);

  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border bg-card shadow-lg',
        className
      )}
    >
      {/* 仅非视频角色时使用音频元素；视频角色只展示合并后的带音视频，进度条为视频进度 */}
      {!characterIsVideo && (
        <audio
          ref={audioRef}
          src={ttsAudioUrl}
          preload="auto"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      <div className="relative shrink-0 border-b bg-gradient-to-b from-muted/30 to-transparent">
        <div className="flex justify-center px-4 pt-6 pb-2">
          <div className="relative aspect-video w-full max-w-[560px] overflow-hidden rounded-2xl border-2 border-border/80 shadow-xl bg-black">
            {mergeLoading ? (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <Loader2 className="size-10 animate-spin" />
                <span className="ml-2 text-sm">{t('audiobook.merge_loading')}</span>
              </div>
            ) : useMerged && mergedVideoUrl ? (
              <video
                key={mergedVideoUrl}
                ref={mergedVideoRef}
                src={mergedVideoUrl}
                className="h-full w-full object-contain"
                playsInline
                preload="auto"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            ) : characterIsVideo && mergeError ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-destructive font-medium">
                  {mergeError === 'insufficient_credits_for_merge'
                    ? t('insufficient_credits_for_merge')
                    : t('audiobook.merge_failed')}
                </p>
                <p className="text-muted-foreground text-sm">
                  {mergeError === 'insufficient_credits_for_merge'
                    ? t('credits_cost_merge')
                    : t('audiobook.merge_failed_hint')}
                </p>
                {mergeError !== 'insufficient_credits_for_merge' && (
                  <Button onClick={handleMergeRetry} variant="secondary" size="sm">
                    <RefreshCw className="mr-2 size-4" />
                    {t('audiobook.retry')}
                  </Button>
                )}
              </div>
            ) : characterIsVideo && !mergeError ? (
              <video
                ref={videoRef}
                src={characterImageUrl}
                className="h-full w-full object-contain"
                playsInline
                loop
                muted
                preload="auto"
              />
            ) : (
              <LazyImage
                src={characterImageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 rounded-2xl ring-2 ring-inset ring-white/20 pointer-events-none" />
          </div>
        </div>

        {/* 合成后的有声书：视频下方显示播放按钮、进度条、下载 */}
        {useMerged && mergedVideoUrl && !mergeError && (
          <div className="mx-4 mb-4 max-w-[560px] rounded-xl border bg-muted/40 p-3 shadow-sm">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  className="size-11 shrink-0 rounded-full shadow-md"
                  onClick={handlePlayPause}
                  disabled={!audioReady}
                >
                  {isPlaying ? (
                    <Pause className="size-5" />
                  ) : (
                    <Play className="size-5 translate-x-0.5" />
                  )}
                </Button>
                <div className="flex flex-1 flex-col gap-1">
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleSeek}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow"
                  />
                  <div className="text-muted-foreground flex justify-between text-xs">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
                <a
                  href={`/${locale}/create-book/download?url=${encodeURIComponent(mergedVideoUrl)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                >
                  <Download className="size-4" />
                  {t('audiobook.download')}
                </a>
              </div>
            </div>
          </div>
        )}

        <p className="text-muted-foreground pb-3 text-center text-sm font-medium">
          {t('audiobook.read_along_subtitle')}
        </p>
      </div>

      {/* 故事正文：随播放高亮并自动滚动 */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-5 md:px-6"
        style={{ maxHeight: 'min(50vh, 360px)' }}
      >
        <div className="font-serif text-base leading-relaxed text-foreground/95 md:text-lg">
          {paragraphs.map((para, i) => (
            <p
              key={i}
              ref={(el) => {
                paragraphRefs.current[i] = el;
              }}
              className={cn(
                'border-primary/30 mb-4 rounded-r-md border-l-4 py-1 pl-4 pr-2 transition-all duration-300',
                i === safeActiveIndex
                  ? 'bg-primary/10 text-foreground'
                  : 'bg-transparent text-muted-foreground'
              )}
            >
              {para}
            </p>
          ))}
        </div>
      </div>

      {/* 底部播放条：仅在有图片+音频（未合并为视频）时展示；合成后的有声书已在视频下方展示播放条 */}
      {!useMerged && !characterIsVideo && !mergeError && (
        <div className="border-t bg-muted/30 px-4 py-4 md:px-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Button
                size="icon"
                className="size-12 shrink-0 rounded-full shadow-md"
                onClick={handlePlayPause}
                disabled={!audioReady}
              >
                {isPlaying ? (
                  <Pause className="size-6" />
                ) : (
                  <Play className="size-6 translate-x-0.5" />
                )}
              </Button>
              <div className="flex flex-1 flex-col gap-1">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow"
                />
                <div className="text-muted-foreground flex justify-between text-xs">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
              <Volume2 className="text-muted-foreground size-5 shrink-0" aria-hidden />
            </div>
            <p className="text-muted-foreground text-center text-xs">
              {t('audiobook.listen_tip')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
