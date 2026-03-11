'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ImageIcon,
  Loader2,
  Mic,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Sparkles,
  BookMarked,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { Link } from '@/core/i18n/navigation';
import { AIMediaType, AITaskStatus } from '@/extensions/ai/types';
import {
  ImageUploader,
  ImageUploaderValue,
  LazyImage,
} from '@/shared/blocks/common';
import { AudiobookReadAlong } from '@/shared/blocks/generator/audiobook-read-along';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Progress } from '@/shared/components/ui/progress';
import { Textarea } from '@/shared/components/ui/textarea';
import { useAppContext } from '@/shared/contexts/app';
import { cn } from '@/shared/lib/utils';

const STEPS = [
  { key: 1, icon: ImageIcon },
  { key: 2, icon: BookOpen },
  { key: 3, icon: Mic },
  { key: 4, icon: BookMarked },
] as const;
type StepNum = 1 | 2 | 3 | 4;

/** Indices for step2 prompt examples (labels and texts in locale: step2_example_N_label, step2_example_N_text). */
const STEP2_PROMPT_EXAMPLE_IDS = [1, 2, 3, 4, 5, 6] as const;

const CHARACTER_POLL_INTERVAL = 5000;
const CHARACTER_GENERATION_TIMEOUT = 300000; // 5 min for video
const DEFAULT_CARTOON_PROVIDER = 'kie';
const DEFAULT_CARTOON_MODEL = 'bytedance/seedance-1.5-pro';

/** Preset TTS voice options (value = API voice id/name, label = display name). */
const TTS_VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Rachel', label: 'Rachel' },
  { value: 'Aria', label: 'Aria' },
  { value: 'Roger', label: 'Roger' },
  { value: 'Sarah', label: 'Sarah' },
  { value: 'Laura', label: 'Laura' },
  { value: 'Charlie', label: 'Charlie' },
  { value: 'George', label: 'George' },
  { value: 'Callum', label: 'Callum' },
  { value: 'River', label: 'River' },
  { value: 'Liam', label: 'Liam' },
  { value: 'Charlotte', label: 'Charlotte' },
  { value: 'Alice', label: 'Alice' },
  { value: 'Matilda', label: 'Matilda' },
  { value: 'Will', label: 'Will' },
  { value: 'Jessica', label: 'Jessica' },
  { value: 'Eric', label: 'Eric' },
  { value: 'Chris', label: 'Chris' },
  { value: 'Brian', label: 'Brian' },
  { value: 'Daniel', label: 'Daniel' },
  { value: 'Lily', label: 'Lily' },
  { value: 'Bill', label: 'Bill' },
  { value: 'BIvP0GN1cAtSRTxNHnWS', label: 'Ellen - Serious, Direct and Confident' },
  { value: 'aMSt68OGf4xUZAnLpTU8', label: 'Juniper - Grounded and Professional' },
  { value: 'RILOU7YmBhvwJGDGjNmP', label: 'Jane - Professional Audiobook Reader' },
  { value: 'EkK5I93UQWFDigLMpZcX', label: 'James - Husky, Engaging and Bold' },
  { value: 'Z3R5wn05IrDiVCyEkUrK', label: 'Arabella - Mysterious and Emotive' },
  { value: 'tnSpp4vdxKPjI9w0GnoV', label: 'Hope - upbeat and clear' },
  { value: 'NNl6r8mD7vthiJatiJt1', label: 'Bradford - Expressive and Articulate' },
  { value: 'YOq2y2Up4RgXP2HyXjE5', label: 'Xavier - Dominating, Metalic Announcer' },
  { value: 'Bj9UqZbhQsanLzgalpEG', label: 'Austin - Deep, Raspy and Authentic' },
  { value: 'c6SfcYrb2t09NHXiT80T', label: 'Jarnathan - Confident and Versatile' },
  { value: 'B8gJV1IhpuegLxdpXFOE', label: 'Kuon - Cheerful, Clear and Steady' },
  { value: 'exsUS4vynmxd379XN4yO', label: 'Blondie - Conversational' },
  { value: 'BpjGufoPiobT79j2vtj4', label: 'Priyanka - Calm, Neutral and Relaxed' },
  { value: '2zRM7PkgwBPiau2jvVXc', label: 'Monika Sogam - Deep and Natural' },
  { value: '1SM7GgM6IMuvQlz2BwM3', label: 'Mark - Casual, Relaxed and Light' },
  { value: 'ouL9IsyrSnUkCmfnD02u', label: 'Grimblewood Thornwhisker - Snarky Gnome & Magical Maintainer' },
  { value: '5l5f8iK3YPeGga21rQIX', label: 'Adeline - Feminine and Conversational' },
  { value: 'scOwDtmlUjD3prqpp97I', label: 'Sam - Support Agent' },
  { value: 'NOpBlnGInO9m6vDvFkFC', label: 'Spuds Oxley - Wise and Approachable' },
  { value: 'BZgkqPqms7Kj9ulSkVzn', label: 'Eve - Authentic, Energetic and Happy' },
  { value: 'wo6udizrrtpIxWGp2qJk', label: 'Northern Terry' },
  { value: 'yjJ45q8TVCrtMhEKurxY', label: 'Dr. Von - Quirky, Mad Scientist' },
  { value: 'gU0LNdkMOQCOrPrwtbee', label: 'British Football Announcer' },
  { value: 'DGzg6RaUqxGRTHSBjfgF', label: 'Brock - Commanding and Loud Sergeant' },
  { value: 'DGTOOUoGpoP6UZ9uSWfA', label: 'Célian - Documentary Narrator' },
  { value: 'x70vRnQBMBu4FAYhjJbO', label: 'Nathan – Virtual Radio Host' },
  { value: 'P1bg08DkjqiVEzOn76yG', label: 'Viraj - Rich and Soft' },
  { value: 'qDuRKMlYmrm8trt5QyBn', label: 'Taksh - Calm, Serious and Smooth' },
  { value: 'kUUTqKQ05NMGulF08DDf', label: 'Guadeloupe Merryweather - Emotional' },
  { value: 'qXpMhyvQqiRxWQs4qSSB', label: 'Horatius – Energetic Character Voice' },
  { value: 'TX3LPaxmHKxFdv7VOQHJ', label: 'Liam - Energetic, Social Media Creator' },
  { value: 'iP95p4xoKVk53GoZ742B', label: 'Chris - Charming, Down-to-Earth' },
  { value: 'SOYHLrjzK2X1ezoPC6cr', label: 'Harry - Fierce Warrior' },
  { value: 'N2lVS1w4EtoT3dr4eOWO', label: 'Callum - Husky Trickster' },
  { value: 'FGY2WhTYpPnrIDTdsKH5', label: 'Laura - Enthusiast, Quirky Attitude' },
  { value: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte' },
  { value: 'cgSgspJ2msm6clMCkdW9', label: 'Jessica - Playful, Bright, Warm' },
  { value: 'MnUw1cSnpiLoLhpd3Hqp', label: 'Heather Rey - Rushed and Friendly' },
  { value: 'kPzsL2i3teMYv0FxEYQ6', label: 'Brittney - Social Media Voice - Fun, Youthful & Informative' },
  { value: 'UgBBYS2sOqTuMpoF3BR0', label: 'Mark - Natural Conversations' },
  { value: 'IjnA9kwZJHJ20Fp7Vmy6', label: 'Matthew - Casual, Friendly and Smooth' },
  { value: 'KoQQbl9zjAdLgKZjm8Ol', label: 'Pro Narrator - Convincing story teller' },
  { value: 'hpp4J3VqNfWAUOO0d1Us', label: 'Bella - Professional, Bright, Warm' },
  { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam - Dominant, Firm' },
  { value: 'nPczCjzI2devNBz1zQrb', label: 'Brian - Deep, Resonant and Comforting' },
  { value: 'L0Dsvb3SLTyegXwtm47J', label: 'Archer' },
  { value: 'uYXf8XasLslADfZ2MB4u', label: 'Hope - Bubbly, Gossipy and Girly' },
  { value: 'gs0tAILXbY5DNrJrsM6F', label: 'Jeff - Classy, Resonating and Strong' },
  { value: 'DTKMou8ccj1ZaWGBiotd', label: 'Jamahal - Young, Vibrant, and Natural' },
  { value: 'vBKc2FfBKJfcZNyEt1n6', label: 'Finn - Youthful, Eager and Energetic' },
  { value: 'TmNe0cCqkZBMwPWOd3RD', label: 'Smith - Mellow, Spontaneous, and Bassy' },
  { value: 'DYkrAHD8iwork3YSUBbs', label: 'Tom - Conversations & Books' },
  { value: '56AoDkrOh6qfVPDXZ7Pt', label: 'Cassidy - Crisp, Direct and Clear' },
  { value: 'eR40ATw9ArzDf9h3v7t7', label: 'Addison 2.0 - Australian Audiobook & Podcast' },
  { value: 'g6xIsTj2HwM6VR4iXFCw', label: 'Jessica Anne Bogart - Chatty and Friendly' },
  { value: 'lcMyyd2HUfFzxdCaC4Ta', label: 'Lucy - Fresh & Casual' },
  { value: '6aDn1KB0hjpdcocrUkmq', label: 'Tiffany - Natural and Welcoming' },
  { value: 'Sq93GQT4X1lKDXsQcixO', label: 'Felix - Warm, positive & contemporary RP' },
  { value: 'vfaqCOvlrKi4Zp7C2IAm', label: 'Malyx - Echoey, Menacing and Deep Demon' },
  { value: 'piI8Kku0DcvcL6TTSeQt', label: 'Flicker - Cheerful Fairy & Sparkly Sweetness' },
  { value: 'KTPVrSVAEUSJRClDzBw7', label: 'Bob - Rugged and Warm Cowboy' },
  { value: 'flHkNRp1BlvT73UL6gyz', label: 'Jessica Anne Bogart - Eloquent Villain' },
  { value: '9yzdeviXkFddZ4Oz8Mok', label: 'Lutz - Chuckling, Giggly and Cheerful' },
  { value: 'pPdl9cQBQq4p6mRkZy2Z', label: 'Emma - Adorable and Upbeat' },
  { value: '0SpgpJ4D3MpHCiWdyTg3', label: 'Matthew Schmitz - Elitist, Arrogant, Conniving Tyrant' },
  { value: 'UFO0Yv86wqRxAt1DmXUu', label: 'Sarcastic and Sultry Villain' },
  { value: 'oR4uRy4fHDUGGISL0Rev', label: 'Myrrdin - Wise and Magical Narrator' },
  { value: 'zYcjlYFOd3taleS0gkk3', label: 'Edward - Loud, Confident and Cocky' },
  { value: 'nzeAacJi50IvxcyDnMXa', label: 'Marshal - Friendly, Funny Professor' },
  { value: 'ruirxsoakN0GWmGNIo04', label: 'Marshal - Friendly, Funny Professor' },
  { value: '1KFdM0QCwQn4rmn5nn9C', label: 'John Morgan - Gritty, Rugged Cowboy' },
  { value: 'TC0Zp7WVFzhA8zpTlRqV', label: 'Parasyte - Whispers from the Deep Dark' },
  { value: 'ljo9gAlSqKOvF6D8sOsX', label: 'Aria - Sultry Villain' },
  { value: 'PPzYpIqttlTYA83688JI', label: 'Viking Bjorn - Epic Medieval Raider' },
  { value: 'ZF6FPAbjXT4488VcRRnw', label: 'Pirate Marshal' },
  { value: '8JVbfL6oEdmuxKn5DK2C', label: 'Amelia - Enthusiastic and Expressive' },
  { value: 'iCrDUkL56s3C8sCRl7wb', label: 'Johnny Kid - Serious and Calm Narrator' },
  { value: '1hlpeD1ydbI2ow0Tt3EW', label: 'Hope - Poetic, Romantic and Captivating' },
  { value: 'wJqPPQ618aTW29mptyoc', label: 'Olivia - Smooth, Warm and Engaging' },
  { value: 'EiNlNiXeDU1pqqOPrYMO', label: 'Ana Rita - Smooth, Expressive and Bright' },
  { value: 'EiNlNiXeDU1pqqOPrYMO', label: 'John Doe - Deep' },
  { value: 'FUfBrNit0NNZAwb58KWH', label: 'Angela - Conversational and Friendly' },
  { value: '4YYIPFl9wE5c4L2eu2Gb', label: 'Burt Reynolds™ - Deep, Smooth and clear' },
  { value: 'OYWwCdDHouzDwiZJWOOu', label: 'David - Gruff Cowboy' },
  { value: '6F5Zhi321D3Oq7v1oNT4', label: 'Hank - Deep and Engaging Narrator' },
  { value: 'qNkzaJoHLLdpvgh5tISm', label: 'Carter - Rich, Smooth and Rugged' },
  { value: 'YXpFCvM1S3JbWEJhoskW', label: 'Wyatt- Wise Rustic Cowboy' },
  { value: '9PVP7ENhDskL0KYHAKtD', label: 'Jerry B. - Southern/Cowboy' },
  { value: 'LG95yZDEHg6fCZdQjLqj', label: 'Phil - Explosive, Passionate Announcer' },
  { value: 'CeNX9CMwmxDxUF5Q2Inm', label: 'Johnny Dynamite - Vintage Radio DJ' },
  { value: 'st7NwhTPEzqo2riw7qWC', label: 'Blondie - Radio Host' },
  { value: 'aD6riP1btT197c6dACmy', label: 'Rachel M - Pro British Radio Presenter' },
  { value: 'FF7KdobWPaiR0vkcALHF', label: 'David - Movie Trailer Narrator' },
  { value: 'mtrellq69YZsNwzUSyXh', label: 'Rex Thunder - Deep N Tough' },
  { value: 'dHd5gvgSOzSfduK4CvEg', label: 'Ed - Late Night Announcer' },
  { value: 'cTNP6ZM2mLTKj2BFhxEh', label: 'Paul French - Podcaster' },
  { value: 'eVItLK1UvXctxuaRV2Oq', label: 'Jean - Alluring and Playful Femme Fatale' },
  { value: 'U1Vk2oyatMdYs096Ety7', label: 'Michael - Deep, Dark and Urban' },
  { value: 'esy0r39YPLQjOczyOib8', label: 'Britney - Calm and Calculative Villain' },
  { value: 'bwCXcoVxWNYMlC6Esa8u', label: 'Matthew Schmitz - Gravel, Deep Anti-Hero' },
  { value: 'D2jw4N9m4xePLTQ3IHjU', label: 'Ian - Strange and Distorted Alien' },
  { value: 'Tsns2HvNFKfGiNjllgqo', label: 'Sven - Emotional and Nice' },
  { value: 'Atp5cNFg1Wj5gyKD7HWV', label: 'Natasha - Gentle Meditation' },
  { value: '1cxc5c3E9K6F1wlqOJGV', label: 'Emily - Gentile, Soft and Meditative' },
  { value: '1U02n4nD6AdIZ9CjF053', label: 'Viraj - Smooth and Gentle' },
  { value: 'HgyIHe81F3nXywNwkraY', label: 'Nate - Sultry, Whispery and Seductive' },
  { value: 'AeRdCCKzvd23BpJoofzx', label: 'Nathaniel - Engaging, British and Calm' },
  { value: 'LruHrtVF6PSyGItzMNHS', label: 'Benjamin - Deep, Warm, Calming' },
  { value: 'Qggl4b0xRMiqOwhPtVWT', label: 'Clara - Relaxing, Calm and Soothing' },
  { value: 'zA6D7RyKdc2EClouEMkP', label: 'AImee - Tranquil ASMR and Meditation' },
  { value: '1wGbFxmAM3Fgw63G1zZJ', label: 'Allison - Calm, Soothing and Meditative' },
  { value: 'hqfrgApggtO1785R4Fsn', label: 'Theodore HQ - Serene and Grounded' },
  { value: 'sH0WdfE5fsKuM2otdQZr', label: 'Koraly – Soft-spoken and Gentle' },
  { value: 'MJ0RnG71ty4LH3dvNfSd', label: 'Leon - Soothing and Grounded' },
];

/** Credits cost for create-book steps (must match backend). */
const CREDITS_VIDEO = 8;
const CREDITS_STORY = 4;
const CREDITS_VOICE = 8;
const CREDITS_MERGE = 4;

function parseCharacterTaskResult(taskResult: string | null): any {
  if (!taskResult) return null;
  try {
    return JSON.parse(taskResult);
  } catch {
    return null;
  }
}

function extractCharacterImageUrls(result: any): string[] {
  if (!result) return [];
  const output = result.output ?? result.images ?? result.data;
  if (!output) return [];
  if (typeof output === 'string') return [output];
  if (Array.isArray(output)) {
    return output
      .flatMap((item: any) => {
        if (!item) return [];
        if (typeof item === 'string') return [item];
        if (typeof item === 'object') {
          const c = item.url ?? item.uri ?? item.image ?? item.src ?? item.imageUrl;
          return typeof c === 'string' ? [c] : [];
        }
        return [];
      })
      .filter(Boolean);
  }
  if (typeof output === 'object') {
    const c = output.url ?? output.uri ?? output.image ?? output.src ?? output.imageUrl;
    if (typeof c === 'string') return [c];
  }
  return [];
}

function extractCharacterVideoUrls(result: any): string[] {
  if (!result) return [];
  const videos = result.videos;
  if (Array.isArray(videos)) {
    return videos
      .map((v: any) => (v && typeof v === 'object' ? v.videoUrl : null))
      .filter(Boolean);
  }
  const urls = result.resultUrls;
  if (Array.isArray(urls)) return urls.filter((u: any) => typeof u === 'string');
  return [];
}

function extractTextFromParts(parts: { type?: string; text?: string }[]): string {
  if (!parts?.length) return '';
  return parts
    .filter((p) => p.type === 'text' && p.text)
    .map((p) => p.text!)
    .join('\n\n');
}

const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|ogg|aac|webm)(\?|$)/i;
function isAudioUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return AUDIO_EXTENSIONS.test(path);
  } catch {
    return false;
  }
}

const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i;
function isVideoUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return VIDEO_EXTENSIONS.test(path);
  } catch {
    return false;
  }
}

export function CreateBookWizard({ className }: { className?: string }) {
  const t = useTranslations('pages.create-book.wizard');
  const tStory = useTranslations('ai.story.generator');
  const searchParams = useSearchParams();
  const { user, setIsShowSignModal, fetchUserCredits } = useAppContext();

  const [step, setStep] = useState<StepNum>(1);
  const [characterGeneratedUrl, setCharacterGeneratedUrl] = useState('');
  const [characterIsVideo, setCharacterIsVideo] = useState(false);
  const [characterPastedUrl, setCharacterPastedUrl] = useState('');
  const [characterUploadedVideoUrl, setCharacterUploadedVideoUrl] = useState('');
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const characterImageUrl =
    characterPastedUrl.trim() || characterUploadedVideoUrl || characterGeneratedUrl;
  // Video: from generated result, pasted video URL, or uploaded local video
  const characterMediaIsVideo =
    (characterIsVideo && !characterPastedUrl.trim() && !characterUploadedVideoUrl) ||
    (!!characterPastedUrl.trim() && isVideoUrl(characterPastedUrl.trim())) ||
    !!characterUploadedVideoUrl;
  const [characterPhotoItems, setCharacterPhotoItems] = useState<ImageUploaderValue[]>([]);
  const [characterPhotoUrls, setCharacterPhotoUrls] = useState<string[]>([]);
  const [characterCartoonPrompt, setCharacterCartoonPrompt] = useState('');
  const [isGeneratingCharacter, setIsGeneratingCharacter] = useState(false);
  const [characterProgress, setCharacterProgress] = useState(0);
  const [characterTaskId, setCharacterTaskId] = useState<string | null>(null);
  const [characterGenerationStartTime, setCharacterGenerationStartTime] = useState<number | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [storyText, setStoryText] = useState('');
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);

  const [keywords, setKeywords] = useState('');
  const [storyStatus, setStoryStatus] = useState<'idle' | 'submitted' | 'error'>('idle');
  const [speakerAudioUrl, setSpeakerAudioUrl] = useState<string | null>(null);
  const [speakerAudioFile, setSpeakerAudioFile] = useState<File | null>(null);
  const [ttsVoice, setTtsVoice] = useState<string>('Rachel');
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);

  const storyPreviewRef = useRef<HTMLDivElement>(null);
  const storyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAccRef = useRef('');
  const rafIdRef = useRef<number | null>(null);

  const chatIdFromUrl = searchParams.get('chatId');

  // 流式更新：用 rAF 将 streamAccRef 同步到 setStoryText，保证每帧最多一次更新，流畅展示
  const flushStreamToState = useCallback(() => {
    rafIdRef.current = null;
    setStoryText(streamAccRef.current);
  }, []);

  const scheduleStreamFlush = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(flushStreamToState);
  }, [flushStreamToState]);

  // 生成故事时，文本框自动滚动到底部以显示最新流式内容
  useEffect(() => {
    if (storyStatus === 'submitted' && storyText && storyTextareaRef.current) {
      storyTextareaRef.current.scrollTop = storyTextareaRef.current.scrollHeight;
    }
  }, [storyStatus, storyText]);

  useEffect(() => {
    if (user) fetchUserCredits?.();
  }, [user, fetchUserCredits]);

  useEffect(() => {
    if (!chatIdFromUrl || !user) return;
    setLoadingChat(true);
    fetch(`/api/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: chatIdFromUrl, page: 1, limit: 50 }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.code !== 0 || !res.data?.list) {
          toast.error('Failed to load story');
          return;
        }
        const text = res.data.list
          .filter((m: { role: string }) => m.role === 'assistant')
          .map((m: { parts?: string | { type?: string; text?: string }[] }) => {
            const parts = typeof m.parts === 'string' ? JSON.parse(m.parts) : m.parts ?? [];
            return extractTextFromParts(Array.isArray(parts) ? parts : []);
          })
          .filter(Boolean)
          .join('\n\n');
        setStoryText(text);
        setChatId(chatIdFromUrl);
        setStep(3);
        window.history.replaceState({}, '', window.location.pathname + (window.location.search.replace(/\?chatId=[^&]+&?|&?chatId=[^&]+/g, '').replace(/\?$/, '') || '?'));
      })
      .catch(() => toast.error('Failed to load story'))
      .finally(() => setLoadingChat(false));
  }, [chatIdFromUrl, user]);

  const handleCharacterPhotoChange = useCallback((items: ImageUploaderValue[]) => {
    setCharacterPhotoItems(items);
    setCharacterPhotoUrls(
      items.filter((i) => i.status === 'uploaded' && i.url).map((i) => i.url as string)
    );
  }, []);

  const handleUploadVideo = useCallback(
    async (file: File) => {
      if (!user) {
        setIsShowSignModal(true);
        return;
      }
      setIsUploadingVideo(true);
      try {
        const form = new FormData();
        form.append('files', file);
        const r = await fetch('/api/storage/upload-video', { method: 'POST', body: form });
        const res = await r.json();
        if (res.code === 0 && res.data?.urls?.length > 0) {
          setCharacterUploadedVideoUrl(res.data.urls[0]);
          toast.success(t('step1_upload_video_done'));
        } else {
          toast.error(res.message || t('step1_upload_video_failed'));
        }
      } catch {
        toast.error(t('step1_upload_video_failed'));
      } finally {
        setIsUploadingVideo(false);
      }
    },
    [user, t, setIsShowSignModal]
  );

  const resetCharacterTask = useCallback(() => {
    setIsGeneratingCharacter(false);
    setCharacterProgress(0);
    setCharacterTaskId(null);
    setCharacterGenerationStartTime(null);
  }, []);

  const pollCharacterTask = useCallback(
    async (id: string) => {
      try {
        if (
          characterGenerationStartTime &&
          Date.now() - characterGenerationStartTime > CHARACTER_GENERATION_TIMEOUT
        ) {
          resetCharacterTask();
          toast.error(t('step1_generate_timeout'));
          return true;
        }
        const resp = await fetch('/api/ai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: id }),
        });
        if (!resp.ok) throw new Error('request failed');
        const { code, message, data } = await resp.json();
        if (code !== 0) throw new Error(message || 'Query failed');
        const task = data as { status: string; taskInfo: string | null };
        const status = task.status as AITaskStatus;
        const parsed = parseCharacterTaskResult(task.taskInfo);
        const videoUrls = extractCharacterVideoUrls(parsed);
        const imageUrls = extractCharacterImageUrls(parsed);
        const urls = videoUrls.length > 0 ? videoUrls : imageUrls;

        if (status === AITaskStatus.PENDING) {
          setCharacterProgress((p) => Math.max(p, 20));
          return false;
        }
        if (status === AITaskStatus.PROCESSING) {
          if (urls.length > 0) {
            setCharacterGeneratedUrl(urls[0]);
            setCharacterIsVideo(videoUrls.length > 0);
          }
          setCharacterProgress((p) => Math.min(p + 10, 85));
          return false;
        }
        if (status === AITaskStatus.SUCCESS) {
          if (urls.length > 0) {
            setCharacterGeneratedUrl(urls[0]);
            setCharacterIsVideo(videoUrls.length > 0);
            toast.success(t('step1_cartoon_done'));
          } else {
            toast.error(t('step1_cartoon_no_image'));
          }
          setCharacterProgress(100);
          resetCharacterTask();
          fetchUserCredits?.();
          return true;
        }
        if (status === AITaskStatus.FAILED) {
          toast.error(parsed?.errorMessage || t('step1_cartoon_failed'));
          resetCharacterTask();
          fetchUserCredits?.();
          return true;
        }
        setCharacterProgress((p) => Math.min(p + 5, 95));
        return false;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : 'Query failed');
        resetCharacterTask();
        fetchUserCredits?.();
        return true;
      }
    },
    [characterGenerationStartTime, resetCharacterTask, t, fetchUserCredits]
  );

  useEffect(() => {
    if (!characterTaskId || !isGeneratingCharacter) return;
    let cancelled = false;
    const tick = async () => {
      if (!characterTaskId) return;
      const done = await pollCharacterTask(characterTaskId);
      if (done) cancelled = true;
    };
    tick();
    const interval = setInterval(async () => {
      if (cancelled || !characterTaskId) {
        clearInterval(interval);
        return;
      }
      const done = await pollCharacterTask(characterTaskId);
      if (done) clearInterval(interval);
    }, CHARACTER_POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [characterTaskId, isGeneratingCharacter, pollCharacterTask]);

  const handleGenerateCharacter = useCallback(async () => {
    if (!user) {
      setIsShowSignModal(true);
      return;
    }
    if (characterPhotoUrls.length === 0) {
      toast.error(t('step1_upload_photo_first'));
      return;
    }
    const creditsResp = await fetch('/api/user/get-user-credits', { method: 'POST' });
    const creditsJson = await creditsResp.json();
    const remaining =
      creditsJson?.code === 0 && creditsJson?.data?.remainingCredits != null
        ? Number(creditsJson.data.remainingCredits)
        : 0;
    if (remaining < CREDITS_VIDEO) {
      toast.error(t('insufficient_credits_for_video'));
      return;
    }
    const prompt = characterCartoonPrompt.trim() || t('step1_cartoon_prompt_default');
    setIsGeneratingCharacter(true);
    setCharacterProgress(15);
    setCharacterGenerationStartTime(Date.now());
    setCharacterTaskId(null);
    setCharacterIsVideo(true); // we are requesting video
    try {
      const resp = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaType: AIMediaType.VIDEO,
          scene: 'image-to-video',
          provider: DEFAULT_CARTOON_PROVIDER,
          model: DEFAULT_CARTOON_MODEL,
          prompt,
          options: { image_input: characterPhotoUrls },
        }),
      });
      if (!resp.ok) throw new Error('request failed');
      const { code, message, data } = await resp.json();
      if (code !== 0) throw new Error(message || 'Failed');
      const taskId = data?.id;
      if (!taskId) throw new Error('No task id');
      if (data?.status === AITaskStatus.SUCCESS && data?.taskInfo) {
        const parsed = parseCharacterTaskResult(data.taskInfo);
        const videoUrls = extractCharacterVideoUrls(parsed);
        const imageUrls = extractCharacterImageUrls(parsed);
        const urls = videoUrls.length > 0 ? videoUrls : imageUrls;
        if (urls.length > 0) {
          setCharacterGeneratedUrl(urls[0]);
          setCharacterIsVideo(videoUrls.length > 0);
          toast.success(t('step1_cartoon_done'));
          setCharacterProgress(100);
          resetCharacterTask();
          fetchUserCredits?.();
          return;
        }
      }
      setCharacterTaskId(taskId);
      setCharacterProgress(25);
      fetchUserCredits?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Generate failed');
      resetCharacterTask();
    }
  }, [
    user,
    characterPhotoUrls,
    characterCartoonPrompt,
    t,
    setIsShowSignModal,
    resetCharacterTask,
    fetchUserCredits,
  ]);

  const handleStorySubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = keywords.trim();
      if (!trimmed) {
        toast.error(tStory('keywords_required'));
        return;
      }
      if (!user) {
        setIsShowSignModal(true);
        toast.info(t('sign_in_required'));
        return;
      }
      const creditsResp = await fetch('/api/user/get-user-credits', { method: 'POST' });
      const creditsJson = await creditsResp.json();
      const remaining =
        creditsJson?.code === 0 && creditsJson?.data?.remainingCredits != null
          ? Number(creditsJson.data.remainingCredits)
          : 0;
      if (remaining < CREDITS_STORY) {
        toast.error(t('insufficient_credits_for_story'));
        return;
      }
      fetchUserCredits?.();
      setStoryStatus('submitted');
      setStoryText('');
      streamAccRef.current = '';
      try {
        const resp = await fetch('/api/ai/generate-story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keywords: trimmed }),
          cache: 'no-store',
        });
        const contentType = resp.headers.get('content-type') || '';
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(errText || `Request failed: ${resp.status}`);
        }
        let finalContent = '';
        // 仅当明确为 JSON 时一次性设置（如错误包装）；流式响应为 text/plain
        if (contentType.includes('application/json')) {
          const { code, message, data } = await resp.json();
          if (code !== 0) throw new Error(message || 'Failed');
          finalContent = data?.text ?? '';
          setStoryText(finalContent);
        } else {
          const reader = resp.body?.getReader();
          if (!reader) throw new Error('No response body');
          const decoder = new TextDecoder();
          let acc = '';
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              acc += decoder.decode(value, { stream: true });
              streamAccRef.current = acc;
              // 用 rAF 调度更新，避免 React 批处理合并掉中间状态，保证流式内容逐帧可见
              scheduleStreamFlush();
            }
            // 刷新 decoder 中可能残留的不完整 UTF-8 序列，确保全文写入 state
            acc += decoder.decode();
            streamAccRef.current = acc;
            setStoryText(acc);
          } finally {
            if (rafIdRef.current != null) {
              cancelAnimationFrame(rafIdRef.current);
              rafIdRef.current = null;
            }
            // 再次确保最终内容已写入（与上面 setStoryText(acc) 可能重复，保证 UI 一定有结果）
            finalContent = streamAccRef.current;
            setStoryText(finalContent);
          }
        }
        requestAnimationFrame(() => {
          if ((finalContent ?? '').trim()) {
            toast.success(t('story_generated') || 'Story generated');
            fetchUserCredits?.();
          } else {
            toast.error(tStory('generate_failed') || 'No story content returned');
          }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : tStory('generate_failed');
        setStoryStatus('error');
        toast.error(msg);
      } finally {
        setStoryStatus('idle');
      }
    },
    [keywords, user, tStory, t, setIsShowSignModal, scheduleStreamFlush, fetchUserCredits]
  );

  const handleTtsSubmit = useCallback(async () => {
    const usePresetVoice = TTS_VOICE_OPTIONS.some((o) => o.value === ttsVoice);
    if (!usePresetVoice && !speakerAudioUrl) {
      toast.error('Upload voice sample first');
      return;
    }
    if (!storyText.trim()) {
      toast.error('No story text');
      return;
    }
    if (!user) {
      setIsShowSignModal(true);
      return;
    }
    const creditsResp = await fetch('/api/user/get-user-credits', { method: 'POST' });
    const creditsJson = await creditsResp.json();
    const remaining =
      creditsJson?.code === 0 && creditsJson?.data?.remainingCredits != null
        ? Number(creditsJson.data.remainingCredits)
        : 0;
    if (remaining < CREDITS_VOICE) {
      toast.error(t('insufficient_credits_for_voice'));
      return;
    }
    setIsGeneratingTts(true);
    try {
      const resp = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: storyText.trim(),
          ...(usePresetVoice ? { voice: ttsVoice } : { speakerAudioUrl }),
        }),
      });
      const { code, data } = await resp.json();
      if (code === 0 && data?.url) {
        setTtsAudioUrl(data.url);
        toast.success(t('step3_voice_generated'));
        fetchUserCredits?.();
      } else {
        toast.info(data?.message || t('step3_voice_unavailable'));
      }
    } catch {
      toast.error(t('step3_voice_failed'));
    } finally {
      setIsGeneratingTts(false);
    }
  }, [speakerAudioUrl, storyText, ttsVoice, t, user, setIsShowSignModal, fetchUserCredits]);

  const handleSpeakerUpload = useCallback(async () => {
    if (!speakerAudioFile || !user) return;
    const form = new FormData();
    form.append('file', speakerAudioFile);
    try {
      const r = await fetch('/api/storage/upload-audio', { method: 'POST', body: form });
      const res = await r.json();
      if (res.url) {
        setSpeakerAudioUrl(res.url);
        toast.success('Voice sample uploaded');
      } else {
        toast.error(res.message || 'Upload failed');
      }
    } catch {
      toast.error('Upload failed');
    }
  }, [speakerAudioFile, user]);

  const currentStepNum = step;

  return (
    <section className={cn('mx-auto max-w-2xl px-4 py-8 md:py-12', className)}>
      {/* Stepper */}
      <div className="mb-10 flex items-center justify-between gap-2">
        {STEPS.map(({ key, icon: Icon }, i) => {
          const active = currentStepNum === key;
          const done = currentStepNum > key;
          return (
            <div key={key} className="flex flex-1 items-center">
              <div
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium transition-colors',
                  active && 'border-primary bg-primary text-primary-foreground',
                  done && 'border-primary bg-primary text-primary-foreground',
                  !active && !done && 'border-muted-foreground/30 bg-muted/50'
                )}
              >
                {done ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1',
                    done ? 'bg-primary' : 'bg-muted'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {loadingChat && (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 className="size-6 animate-spin" />
          <span>Loading story...</span>
        </div>
      )}

      {!loadingChat && step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-5" />
              {t('step1_title')}
            </CardTitle>
            <CardDescription>{t('step1_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">{t('step1_optional')}</p>

            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="font-medium text-sm">{t('step1_option_generate')}</p>
            <div className="space-y-2">
              <Label>{t('step1_upload_photo')}</Label>
              <ImageUploader
                allowMultiple={false}
                maxImages={1}
                maxSizeMB={5}
                onChange={handleCharacterPhotoChange}
                emptyHint={t('step1_upload_photo_hint')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="character-cartoon-prompt">{t('step1_cartoon_prompt_label')}</Label>
              <Textarea
                id="character-cartoon-prompt"
                placeholder={t('step1_cartoon_prompt_default')}
                value={characterCartoonPrompt}
                onChange={(e) => setCharacterCartoonPrompt(e.target.value)}
                rows={2}
                className="resize-none"
                disabled={isGeneratingCharacter}
              />
            </div>

            <Button
              type="button"
              onClick={handleGenerateCharacter}
              disabled={isGeneratingCharacter || characterPhotoUrls.length === 0}
            >
              {isGeneratingCharacter ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('step1_generating_cartoon')}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" />
                  {t('step1_generate_cartoon')}
                </>
              )}
            </Button>
            <span className="text-muted-foreground text-sm">（{t('credits_cost_video')}）</span>

            {isGeneratingCharacter && (
              <div className="space-y-2">
                <Progress value={characterProgress} className="h-2" />
                <p className="text-muted-foreground text-sm">
                  {t('step1_generating_wait_tip')}
                </p>
              </div>
            )}
            </div>

            {characterImageUrl && (
              <div className="space-y-2">
                <Label className="text-muted-foreground text-sm">{t('step1_result_preview')}</Label>
                {characterPastedUrl.trim() && (
                  <p className="text-muted-foreground text-xs">{t('step1_using_pasted_url')}</p>
                )}
                {!characterPastedUrl.trim() && characterUploadedVideoUrl && characterImageUrl === characterUploadedVideoUrl && (
                  <p className="text-muted-foreground text-xs">{t('step1_using_uploaded_video')}</p>
                )}
                <div className="relative aspect-square max-w-[200px] overflow-hidden rounded-lg border">
                  {characterPastedUrl.trim() && isAudioUrl(characterPastedUrl) ? (
                    <div className="flex aspect-square items-center justify-center bg-muted/30 p-4">
                      <audio
                        controls
                        className="w-full max-w-full"
                        src={characterImageUrl}
                      >
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  ) : characterMediaIsVideo ? (
                    <video
                      src={characterImageUrl}
                      className="h-full w-full object-cover"
                      controls
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <LazyImage
                      src={characterImageUrl}
                      alt={t('step1_result_preview')}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <Label htmlFor="character-url" className="text-muted-foreground text-sm">
                {t('step1_or_paste_url')}
              </Label>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('step1_paste_url_hint')}
              </p>
              <Input
                id="character-url"
                type="url"
                placeholder="https://..."
                value={characterPastedUrl}
                onChange={(e) => setCharacterPastedUrl(e.target.value)}
                className="mt-1"
              />
            </div>

            <div className="border-t pt-4 space-y-2">
              <Label className="text-muted-foreground text-sm">
                {t('step1_upload_video')}
              </Label>
              <p className="text-muted-foreground text-xs">
                {t('step1_upload_video_hint')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept="video/*"
                  className="max-w-xs cursor-pointer"
                  disabled={isUploadingVideo}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadVideo(file);
                    e.target.value = '';
                  }}
                />
                {isUploadingVideo && (
                  <>
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    <span className="text-muted-foreground text-sm">{t('step1_uploading_video')}</span>
                  </>
                )}
                {characterUploadedVideoUrl && !characterPastedUrl.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setCharacterUploadedVideoUrl('')}
                  >
                    {t('step1_clear_uploaded_video')}
                  </Button>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t pt-4">
              <Button onClick={() => setStep(2)}>
                {t('next')}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loadingChat && step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-5" />
              {t('step2_title')}
            </CardTitle>
            <CardDescription>{t('step2_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="font-medium text-sm">{t('step2_option_generate')}</p>
              <p className="text-muted-foreground text-xs">（{t('credits_cost_story')}）</p>
            <form onSubmit={handleStorySubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="story-keywords">{tStory('keywords_label')}</Label>
                <p className="text-muted-foreground text-xs">{t('step2_examples_title')}</p>
                <div className="flex flex-wrap gap-2">
                  {STEP2_PROMPT_EXAMPLE_IDS.map((id) => (
                    <Button
                      key={id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto shrink-0 py-1.5 text-xs font-normal"
                      onClick={() => {
                        setKeywords(t(`step2_example_${id}_text`));
                        if (storyStatus === 'error') setStoryStatus('idle');
                      }}
                      disabled={storyStatus === 'submitted'}
                    >
                      {t(`step2_example_${id}_label`)}
                    </Button>
                  ))}
                </div>
                <Textarea
                  id="story-keywords"
                  placeholder={tStory('keywords_placeholder')}
                  value={keywords}
                  onChange={(e) => {
                    setKeywords(e.target.value);
                    if (storyStatus === 'error') setStoryStatus('idle');
                  }}
                  rows={3}
                  className="resize-none"
                  disabled={storyStatus === 'submitted'}
                />
              </div>
              <Button type="submit" disabled={storyStatus === 'submitted'}>
                {storyStatus === 'submitted' ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('generating_story')}
                  </>
                ) : (
                  tStory('generate')
                )}
              </Button>
            </form>
            </div>

            <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
              <Label htmlFor="story-paste" className="font-medium text-sm">{t('step2_option_paste')}</Label>
              <p className="text-muted-foreground text-xs">{t('step2_paste_hint')}</p>
              <Textarea
                id="story-paste"
                ref={storyTextareaRef}
                placeholder={t('step2_paste_placeholder')}
                value={storyText}
                onChange={(e) => {
                  setStoryText(e.target.value);
                  if (storyStatus === 'error') setStoryStatus('idle');
                }}
                rows={8}
                className="min-h-40 resize-y font-normal"
                disabled={storyStatus === 'submitted'}
              />
            </div>

            {storyStatus === 'submitted' && !storyText && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />
                {t('generating_story')}
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 size-4" />
                {t('back')}
              </Button>
              {storyText ? (
                <Button onClick={() => setStep(3)}>
                  {t('next')}
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              ) : (
                <span />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!loadingChat && step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="size-5" />
              {t('step3_title')}
            </CardTitle>
            <CardDescription>{t('step3_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {storyText ? (
              <>
                <div className="space-y-2">
                  <Label>Story (for voice)</Label>
                  <Textarea
                    placeholder={t('story_placeholder')}
                    value={storyText}
                    onChange={(e) => setStoryText(e.target.value)}
                    className="min-h-40 resize-y font-normal"
                    rows={10}
                  />
                  <p className="text-muted-foreground text-xs">
                    {t('story_edit_hint')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Voice</Label>
                  <p className="text-muted-foreground text-xs">
                    Choose a preset voice. You can also upload your own sample below (optional).
                  </p>
                  <select
                    className="border-input bg-background flex h-9 w-full max-w-xs rounded-md border px-3 py-1 text-sm"
                    value={ttsVoice}
                    onChange={(e) => setTtsVoice(e.target.value)}
                  >
                    {TTS_VOICE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 上传音频功能暂时关闭
                <div className="space-y-2">
                  <Label>Voice sample (optional)</Label>
                  <p className="text-muted-foreground text-xs">
                    Upload a short recording (e.g. 30 seconds) of the narrator. We&apos;ll use it to generate the voice. Skip when using Rachel.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => setSpeakerAudioFile(e.target.files?.[0] ?? null)}
                      className="max-w-xs"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={handleSpeakerUpload}
                      disabled={!speakerAudioFile}
                    >
                      Upload
                    </Button>
                    {(speakerAudioUrl || speakerAudioFile) && (
                      <span className="text-muted-foreground text-sm">
                        {speakerAudioFile?.name ?? 'Uploaded'}
                      </span>
                    )}
                  </div>
                </div>
                */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleTtsSubmit}
                    disabled={isGeneratingTts}
                  >
                    {isGeneratingTts ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        {t('step3_generating_voice')}
                      </>
                    ) : (
                      t('step3_generate_voice')
                    )}
                  </Button>
                  <span className="text-muted-foreground text-sm self-center">（{t('credits_cost_voice')}）</span>
                  <Button variant="outline" onClick={() => setStep(4)}>
                    {t('step3_skip_voice')}
                  </Button>
                </div>
                {ttsAudioUrl && (
                  <div className="space-y-2 border-t pt-4">
                    <Label className="text-muted-foreground text-sm">{t('step3_preview_title')}</Label>
                    <p className="text-muted-foreground text-xs">{t('step3_preview_hint')}</p>
                    <audio controls className="w-full" src={ttsAudioUrl}>
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                <Link href="/create-book" className="text-primary underline">
                  Generate a story
                </Link>{' '}
                first, or return from a story chat with &quot;{t('use_this_story')}&quot; to load it here.
              </p>
            )}
            <div className="flex items-center justify-between border-t pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-2 size-4" />
                {t('back')}
              </Button>
              {ttsAudioUrl ? (
                <Button onClick={() => setStep(4)}>
                  {t('step3_next_to_audiobook')}
                  <ArrowRight className="ml-2 size-4" />
                </Button>
              ) : (
                <span />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!loadingChat && step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookMarked className="size-5" />
              {t('step4_title')}
            </CardTitle>
            <CardDescription>{t('step4_description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 当角色图/视频 + 故事 + 音频三者齐全且角色为视觉媒体时，展示有声书跟读体验；若角色为粘贴的音频 URL 则只展示分块预览 */}
            {characterImageUrl && storyText && ttsAudioUrl && !(characterPastedUrl.trim() && isAudioUrl(characterPastedUrl)) ? (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  {t('audiobook.experience_description')}
                </p>
                <p className="text-muted-foreground text-xs">（{t('credits_cost_merge')}）</p>
                <AudiobookReadAlong
                  characterImageUrl={characterImageUrl}
                  characterIsVideo={characterMediaIsVideo}
                  storyText={storyText}
                  ttsAudioUrl={ttsAudioUrl}
                  remainingCredits={user?.credits?.remainingCredits ?? undefined}
                  onCreditsRefresh={fetchUserCredits}
                />
              </div>
            ) : (
              <>
                {characterImageUrl && (
                  <div>
                    <Label className="text-muted-foreground mb-2 block text-xs uppercase">{t('step4_media_label')}</Label>
                    <div className="relative aspect-square max-w-[240px] overflow-hidden rounded-lg border">
                      {characterPastedUrl.trim() && isAudioUrl(characterPastedUrl) ? (
                        <div className="flex aspect-square items-center justify-center bg-muted/30 p-4">
                          <audio controls className="w-full max-w-full" src={characterImageUrl}>
                            Your browser does not support the audio element.
                          </audio>
                        </div>
                      ) : characterMediaIsVideo ? (
                        <video
                          src={characterImageUrl}
                          className="h-full w-full object-cover"
                          controls
                          loop
                          muted
                          playsInline
                        />
                  ) : (
                    <LazyImage
                      src={characterImageUrl}
                      alt={t('step1_result_preview')}
                      className="h-full w-full object-cover"
                    />
                  )}
                    </div>
                  </div>
                )}
                {storyText && (
                  <div>
                    <Label className="text-muted-foreground mb-2 block text-xs uppercase">Story</Label>
                    <div className="bg-muted/50 max-h-60 overflow-y-auto rounded-lg border p-4 text-sm whitespace-pre-wrap">
                      {storyText}
                    </div>
                  </div>
                )}
                {ttsAudioUrl && (
                  <div>
                    <Label className="text-muted-foreground mb-2 block text-xs uppercase">Audiobook</Label>
                    <audio controls className="w-full" src={ttsAudioUrl}>
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                )}
                {!ttsAudioUrl && storyText && (
                  <p className="text-muted-foreground text-sm">
                    {t('step4_no_voice_hint')}
                  </p>
                )}
              </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="mr-2 size-4" />
                {t('back')}
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  {t('start_over')}
                </Button>
                {chatId && (
                  <Button asChild variant="outline">
                    <Link href={`/chat/${chatId}`}>{t('open_in_chat')}</Link>
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="border-t py-3 text-center text-sm text-muted-foreground">
        {user ? (
          <>
            {t('remaining_credits')}：<span className="font-medium text-foreground">{user?.credits?.remainingCredits ?? 0}</span>
          </>
        ) : (
          <span>{t('sign_in_required')}</span>
        )}
      </div>
    </section>
  );
}
