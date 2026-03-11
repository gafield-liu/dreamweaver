'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Volume2, VolumeX } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

type VideoWithMuteProps = {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  ariaLabel?: string;
  className?: string;
  width?: number;
  height?: number;
};

export function VideoWithMuteButton({
  src,
  poster,
  autoPlay = true,
  loop = true,
  muted: initialMuted = true,
  playsInline = true,
  ariaLabel,
  className,
  width,
  height,
}: VideoWithMuteProps) {
  const t = useTranslations('common.video');
  const [isMuted, setIsMuted] = useState(initialMuted);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setProgress((video.currentTime / video.duration) * 100);
      }
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };
    const onEnded = () => setProgress(0);
    const onSeeked = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setProgress((video.currentTime / video.duration) * 100);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [src]);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    video.currentTime = x * duration;
    setProgress(x * 100);
  };

  return (
    <div className="flex flex-col gap-1">
      <video
        ref={videoRef}
        className={className}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        loop={loop}
        muted={isMuted}
        playsInline={playsInline}
        aria-label={ariaLabel}
        width={width}
        height={height}
      />
      <div className="flex flex-col gap-1.5 border-border/25 bg-muted/20 px-2 py-1.5">
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="bg-muted hover:bg-muted/80 h-1.5 w-full cursor-pointer overflow-hidden rounded-full transition-colors"
          onClick={handleProgressClick}
        >
          <div
            className="h-full rounded-full bg-primary/80 transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {duration
              ? `${Math.floor((progress / 100) * duration)}s / ${Math.floor(duration)}s`
              : '—'}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit shrink-0 gap-1.5 border-border/50 bg-background/80 text-foreground hover:bg-muted"
            onClick={() => setIsMuted((m) => !m)}
            aria-label={isMuted ? t('unmute') : t('mute')}
          >
            {isMuted ? (
              <>
                <VolumeX className="size-4" aria-hidden />
                <span>{t('unmute')}</span>
              </>
            ) : (
              <>
                <Volume2 className="size-4" aria-hidden />
                <span>{t('mute')}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
