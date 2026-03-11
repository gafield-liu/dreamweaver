import { NextRequest } from 'next/server';

import { AIMediaType, AITaskStatus } from '@/extensions/ai';
import { getUuid } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { createAITask, updateAITaskById, type NewAITask } from '@/shared/models/ai_task';
import { getRemainingCredits } from '@/shared/models/credit';
import { getUserInfo } from '@/shared/models/user';
import { getAIService } from '@/shared/services/ai';

const TTS_MODEL = 'elevenlabs/text-to-speech-turbo-2-5';
const DEFAULT_VOICE = 'Rachel';
const TTS_CREDITS_COST = 8;
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

/**
 * TTS (text-to-speech) via Kie provider. Consumes TTS_CREDITS_COST credits; refunds on failure.
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
    if (remaining < TTS_CREDITS_COST) {
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
      costCredits: TTS_CREDITS_COST,
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
        if (createdTaskId) {
          await updateAITaskById(createdTaskId, {
            status: AITaskStatus.SUCCESS,
            taskInfo: JSON.stringify(queryResult.taskInfo || info),
          });
        }
        return respData({ url: info.audioUrl });
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
