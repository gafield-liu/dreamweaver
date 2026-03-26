# 构建上下文须为「Git 仓库根目录」（与 Railway 单仓部署一致）：
#   docker build -f workers/audiobook-merge/Dockerfile -t audiobook-merge .
# 若上下文仅为本目录，COPY 会找不到 workers/ 前缀，请勿在子目录单独 build。
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY workers/audiobook-merge/package.json ./
RUN npm install --omit=dev

COPY workers/audiobook-merge/server.mjs ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.mjs"]
