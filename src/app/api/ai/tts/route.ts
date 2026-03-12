import { NextRequest } from 'next/server';

import { AIMediaType, AITaskStatus } from '@/extensions/ai';
import { getUuid } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { createAITask, updateAITaskById, type NewAITask } from '@/shared/models/ai_task';
import { consumeCredits, getRemainingCredits } from '@/shared/models/credit';
import { getUserInfo } from '@/shared/models/user';
import { getAIService } from '@/shared/services/ai';
import { getAudioDurationFromUrl } from '@/shared/lib/audio';

const TTS_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';
const DEFAULT_VOICE = 'Rachel';
/** 每分钟音频消耗的积分（按合成音频时长计费） */
const TTS_CREDITS_PER_MINUTE = 2;
/** 最少消耗积分（不足 1 分钟按 1 积分） */
const TTS_MIN_CREDITS = 1;
/** 发起 TTS 前至少需要的剩余积分（避免 0 积分用户白嫖 API） */
const TTS_MIN_REMAINING_TO_START = 1;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

/**
 * 根据音频时长（秒）计算应扣积分。
 * 公式：max(TTS_MIN_CREDITS, ceil(durationSeconds / 60 * TTS_CREDITS_PER_MINUTE))
 */
function creditsForDurationSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return TTS_MIN_CREDITS;
  const byMinute = Math.ceil((durationSeconds / 60) * TTS_CREDITS_PER_MINUTE);
  return Math.max(TTS_MIN_CREDITS, byMinute);
}

/**
 * TTS (text-to-speech) via Kie provider.
 * 创建任务时不扣费（costCredits=0），合成成功后再根据音频时长扣费；失败不扣费。
 */
export async function POST(req: NextRequest) {
  let createdTaskId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const { text, voice = DEFAULT_VOICE } = body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return respErr('text is required');
    }

    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const remaining = await getRemainingCredits(user.id);
    if (remaining < TTS_MIN_REMAINING_TO_START) {
      return respErr('Insufficient credits for voice generation');
    }

    const aiService = await getAIService();
    const kie = aiService.getProvider('kie');
    if (!kie || !('generateTts' in kie) || !('queryTts' in kie)) {
      return respErr('TTS provider (Kie) is not configured');
    }

    const result = await (kie as any).generateTts({
      params: {
        prompt: text.trim(),
        model: TTS_MODEL,
        options: { voice, text: text.trim() },
      },
    });

    if (!result?.taskId) {
      return respErr('TTS task creation failed');
    }

    const newTask: NewAITask = {
      id: getUuid(),
      userId: user.id,
      mediaType: AIMediaType.SPEECH,
      scene: 'create-book-tts',
      provider: 'kie',
      model: TTS_MODEL,
      prompt: text.trim().slice(0, 500),
      status: AITaskStatus.PROCESSING,
      costCredits: 0, // 成功后再按时长扣费
      options: JSON.stringify({ voice }),
      taskId: result.taskId,
      taskInfo: result.taskInfo ? JSON.stringify(result.taskInfo) : null,
      taskResult: null,
    };
    const created = await createAITask(newTask);
    createdTaskId = created?.id ?? null;

    const taskId = result.taskId;
    const start = Date.now();

    while (Date.now() - start < POLL_TIMEOUT_MS) {
      const queryResult = await (kie as any).queryTts({ taskId });
      const status = queryResult.taskStatus;
      const info = queryResult.taskInfo as { audioUrl?: string } | undefined;

      if (status === 'success' && info?.audioUrl) {
        const audioUrl = info.audioUrl;
        const durationSeconds = await getAudioDurationFromUrl(audioUrl);
        const costCredits = creditsForDurationSeconds(durationSeconds);
        const remainingAfter = await getRemainingCredits(user.id);
        if (remainingAfter < costCredits) {
          if (createdTaskId) {
            await updateAITaskById(createdTaskId, { status: AITaskStatus.FAILED });
          }
          return respErr(
            `Insufficient credits: this audio would cost ${costCredits} credits (${Math.round(durationSeconds)}s). You have ${remainingAfter}.`
          );
        }
        const consumed = await consumeCredits({
          userId: user.id,
          credits: costCredits,
          scene: 'create-book-tts',
          description: `TTS by duration (${Math.round(durationSeconds)}s)`,
          metadata: JSON.stringify({
            type: 'ai-task',
            mediaType: AIMediaType.SPEECH,
            taskId: createdTaskId,
            durationSeconds,
          }),
        });
        if (createdTaskId && consumed?.id) {
          await updateAITaskById(createdTaskId, {
            status: AITaskStatus.SUCCESS,
            taskInfo: JSON.stringify(queryResult.taskInfo || info),
            costCredits,
            creditId: consumed.id,
          });
        }
        return respData({
          url: audioUrl,
          durationSeconds: durationSeconds > 0 ? Math.round(durationSeconds) : undefined,
          creditsConsumed: costCredits,
        });
      }
      if (status === 'failed') {
        const msg = (info as any)?.errorMessage || (info as any)?.errorCode || 'TTS generation failed';
        if (createdTaskId) {
          await updateAITaskById(createdTaskId, { status: AITaskStatus.FAILED });
        }
        return respErr(msg);
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (createdTaskId) {
      await updateAITaskById(createdTaskId, { status: AITaskStatus.FAILED });
    }
    return respErr('TTS generation timed out');
  } catch (e: any) {
    if (createdTaskId) {
      try {
        await updateAITaskById(createdTaskId, { status: AITaskStatus.FAILED });
      } catch (_) {
        // ignore
      }
    }
    console.error('TTS failed', e);
    return respErr(e?.message || 'TTS request failed');
  }
}
