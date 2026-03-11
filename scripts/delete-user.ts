/**
 * Delete User Script
 *
 * 删除指定邮箱或用户 ID 的账号（会级联删除该用户的 session、account、credits 等关联数据）。
 *
 * Usage:
 *   pnpm run user:delete -- --email=your@email.com
 *   pnpm run user:delete -- --user-id=user-id-here
 */

import { eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { envConfigs } from '@/config';

async function loadSchemaTables(): Promise<{ user: any }> {
  if (envConfigs.database_provider === 'mysql') {
    return (await import('@/config/db/schema.mysql')) as any;
  }

  if (['sqlite', 'turso'].includes(envConfigs.database_provider || '')) {
    return (await import('@/config/db/schema.sqlite')) as any;
  }

  return (await import('@/config/db/schema')) as any;
}

async function deleteUser() {
  const args = process.argv.slice(2);
  const emailArg = args.find((arg) => arg.startsWith('--email='));
  const userIdArg = args.find((arg) => arg.startsWith('--user-id='));

  if (!emailArg && !userIdArg) {
    console.error('❌ 请提供 --email= 或 --user-id=');
    console.log('\n用法:');
    console.log('  pnpm run user:delete -- --email=your@email.com');
    console.log('  pnpm run user:delete -- --user-id=用户ID');
    process.exit(1);
  }

  try {
    const { user } = await loadSchemaTables();
    const sqlEq: any = eq;

    let targetUser: { id: string; name: string; email: string } | undefined;

    if (emailArg) {
      const email = emailArg.split('=')[1];
      console.log(`🔍 正在查找邮箱: ${email}`);

      const [found] = await db()
        .select()
        .from(user)
        .where(sqlEq(user.email, email));

      targetUser = found;
    } else if (userIdArg) {
      const userId = userIdArg.split('=')[1];
      console.log(`🔍 正在查找用户 ID: ${userId}`);

      const [found] = await db()
        .select()
        .from(user)
        .where(sqlEq(user.id, userId));

      targetUser = found;
    }

    if (!targetUser) {
      console.error('❌ 未找到对应用户');
      process.exit(1);
    }

    console.log(`✓ 找到用户: ${targetUser.name} (${targetUser.email})`);
    console.log(`🔄 正在删除用户及其关联数据（session、account、credits 等）...`);

    await db().delete(user).where(sqlEq(user.id, targetUser.id));

    console.log(`\n✅ 已删除账号: ${targetUser.email}`);
  } catch (error) {
    console.error('\n❌ 删除失败:', error);
    process.exit(1);
  }
}

deleteUser()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
