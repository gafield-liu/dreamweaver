import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';

import { AIMediaType, AITaskStatus } from '@/extensions/ai';
import { getUuid } from '@/shared/lib/hash';
import { respErr } from '@/shared/lib/resp';
import { createAITask, updateAITaskById, type NewAITask } from '@/shared/models/ai_task';
import { getRemainingCredits } from '@/shared/models/credit';
import { getAllConfigs } from '@/shared/models/config';
import { getUserInfo } from '@/shared/models/user';

const DEFAULT_STORY_MODEL = 'google/gemini-2.0-flash-001';
const FALLBACK_STORY_MODEL = 'deepseek/deepseek-r1';

const REGION_UNAVAILABLE_PATTERN = /not available in your region/i;

/** 每次生成故事消耗的积分 */
const STORY_CREDITS_COST = 4;

// Ensure route is dynamic and response is not cached/buffered so streaming works
export const dynamic = 'force-dynamic';

/**
 * Generate story text from keywords (for create-book flow).
 * Streams model output so the client can show text incrementally.
 * Uses FALLBACK_STORY_MODEL when primary model returns region-unavailable error.
 */
export async function POST(req: Request) {
  let createdTaskId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const { keywords } = body || {};
    const trimmed = typeof keywords === 'string' ? keywords.trim() : '';

    if (!trimmed) {
      return respErr('keywords are required');
    }

    const user = await getUserInfo();
    if (!user) {
      return respErr('no auth, please sign in');
    }

    const configs = await getAllConfigs();
    const openrouterApiKey = configs.openrouter_api_key;
    if (!openrouterApiKey) {
      return respErr('openrouter_api_key is not set');
    }

    const remainingCredits = await getRemainingCredits(user.id);
    if (remainingCredits < STORY_CREDITS_COST) {
      return respErr('Insufficient credits for story generation');
    }

    // Create AI task record for admin visibility (create-book requests)
    const newTask: NewAITask = {
      id: getUuid(),
      userId: user.id,
      mediaType: AIMediaType.TEXT,
      scene: 'create-book',
      provider: 'openrouter',
      model: DEFAULT_STORY_MODEL,
      prompt: trimmed,
      status: AITaskStatus.SUCCESS,
      costCredits: STORY_CREDITS_COST,
      options: null,
      taskId: null,
      taskInfo: null,
      taskResult: JSON.stringify({ note: 'Story streamed to client' }),
    };
    const created = await createAITask(newTask);
    createdTaskId = created?.id ?? null;

    const openrouterBaseUrl = configs.openrouter_base_url;
    const openrouter = createOpenRouter({
      apiKey: openrouterApiKey,
      baseURL: openrouterBaseUrl || undefined,
    });

    // const prompt = `Generate an educational children's story about: ${trimmed}. Write a short, engaging story suitable for a picture book, with clear scenes that could be illustrated.`;
    const prompt = trimmed;

    let lastError: unknown;
    for (const model of [DEFAULT_STORY_MODEL, FALLBACK_STORY_MODEL]) {
      try {
        const result = streamText({
          model: openrouter.chat(model),
          messages: [{ role: 'user', content: prompt }],
        });
        return result.toTextStreamResponse({
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Accel-Buffering': 'no', // nginx: disable buffering
          },
        });
      } catch (e: unknown) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (REGION_UNAVAILABLE_PATTERN.test(msg)) {
          console.warn(`generate-story: ${model} region unavailable, trying fallback`);
          continue;
        }
        throw e;
      }
    }
    console.error('generate-story failed:', lastError);
    return respErr((lastError as Error)?.message || 'Failed to generate story');
  } catch (e: unknown) {
    if (createdTaskId) {
      try {
        await updateAITaskById(createdTaskId, { status: AITaskStatus.FAILED });
      } catch (_) {
        // ignore update error
      }
    }
    console.error('generate-story failed:', e);
    return respErr(e instanceof Error ? e.message : 'Failed to generate story');
  }
}
