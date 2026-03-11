# ShipAny Template Two

## Getting Started

read [ShipAny Document](https://shipany.ai/docs/quick-start) to start your AI SaaS project.

## Credits（积分）配置：默认给新用户 2 次有声书生成机会

- **积分消耗规则**：当前仅「根据关键词生成故事」（create-book 流程中的一步）消耗积分，**每次生成故事 = 消耗 1 积分**。其它步骤（上传素材、TTS、合并视频等）不扣积分。
- **不是每个步骤都扣**：只有「生成故事」这一步扣 1 积分，保证每个登录用户有 2 次机会 = 发放 2 积分即可。
- **如何设置默认 2 次机会**：
  1. 进入后台 **Settings（设置）→ General → Credit**。
  2. 开启 **Initial Credits Enabled**。
  3. **Initial Credits Amount** 设为 `2`。
  4. **Initial Credits Valid Days** 填 `0` 表示永不过期（或填 30 表示 30 天内有效）。
  5. 保存后，新注册用户会自动获得 2 积分；已有用户可用脚本补发：`pnpm run user:grant-initial`（仅对当前剩余积分为 0 的用户补发）。

## Buy Templates

check [ShipAny Templates](https://shipany.ai/templates) to buy Business Templates.

## Feedback

submit your feedbacks on [Github Issues](https://github.com/shipanyai/shipany-template-two/issues)

## LICENSE

!!! Please do not publicly release ShipAny's Code. Illegal use will be prosecuted

[ShipAny LICENSE](./LICENSE)
