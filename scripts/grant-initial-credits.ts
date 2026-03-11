/**
 * Grant Initial Credits Script
 *
 * 为「当前剩余积分为 0」的已有用户补发初始积分（金额与有效期从后台配置或环境变量读取）。
 * 新用户注册时会自动获得初始积分，此脚本仅用于开通该功能后为老用户补发一次。
 *
 * Usage:
 *   pnpm run user:grant-initial
 *   pnpm run user:grant-initial -- --dry-run   # 仅打印将补发的用户，不写入
 */

import { db } from '@/core/db';
import { user, config } from '@/config/db/schema';
import { getRemainingCredits, grantCreditsForUser } from '@/shared/models/credit';
import type { User } from '@/shared/models/user';

function getConfigValue(configs: { name: string; value: string | null }[], key: string): string {
  const row = configs.find((c) => c.name === key);
  const envKey = key.toUpperCase().replace(/-/g, '_');
  return (process.env[envKey] ?? row?.value ?? '') as string;
}

async function grantInitialCredits() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('🔍 [dry-run] 仅预览，不会实际发放积分\n');
  }

  const configRows = await db().select().from(config);
  const get = (key: string) => getConfigValue(configRows, key);
  const amount = parseInt(get('initial_credits_amount')) || 100;
  const validDays = parseInt(get('initial_credits_valid_days')) || 0;
  const description = get('initial_credits_description') || 'initial credits (backfill)';

  console.log(`📋 配置: 每人 ${amount} 积分, 有效天数 ${validDays || '不限'}\n`);

  const limit = 500;
  let page = 1;
  let totalGranted = 0;
  let totalSkipped = 0;

  while (true) {
    const users = await db()
      .select()
      .from(user)
      .limit(limit)
      .offset((page - 1) * limit);

    if (users.length === 0) break;

    for (const u of users as User[]) {
      const remaining = await getRemainingCredits(u.id);
      if (remaining > 0) {
        totalSkipped++;
        continue;
      }
      if (dryRun) {
        console.log(`  [dry-run] 将补发: ${u.email} (${u.name || u.id})`);
        totalGranted++;
        continue;
      }
      try {
        await grantCreditsForUser({
          user: u,
          credits: amount,
          validDays: validDays > 0 ? validDays : 0,
          description,
        });
        console.log(`  ✓ 已补发: ${u.email}`);
        totalGranted++;
      } catch (e) {
        console.error(`  ✗ 补发失败 ${u.email}:`, e);
      }
    }

    if (users.length < limit) break;
    page++;
  }

  console.log(
    `\n✅ 完成. 补发 ${totalGranted} 人, 跳过（已有积分）${totalSkipped} 人${dryRun ? ' (dry-run)' : ''}`
  );
}

grantInitialCredits()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
