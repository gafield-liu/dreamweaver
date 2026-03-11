import { nanoid } from 'nanoid';
import { z } from 'zod';

import { db } from '@/core/db';
import { waitlist } from '@/config/db/schema';
import { respJson, respErr } from '@/shared/lib/resp';

const bodySchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return respErr(parsed.error.errors?.[0]?.message || 'Invalid email');
    }

    const { email } = parsed.data;

    await db().insert(waitlist).values({
      id: nanoid(),
      email: email.toLowerCase().trim(),
      source: 'homepage',
    });

    return respJson(
      0,
      'You\'re on the list! We\'ll notify you when we launch.'
    );
  } catch (e: any) {
    // 唯一约束：邮箱已存在时视为成功
    if (e?.code === '23505' || e?.message?.includes('unique')) {
      return respJson(
        0,
        'You\'re already on the list. We\'ll be in touch!'
      );
    }
    console.error('waitlist signup error:', e);
    return respErr(e?.message || 'Signup failed');
  }
}
