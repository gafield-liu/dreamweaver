FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# 构建上下文须为本目录：cd workers/audiobook-merge && docker build -t audiobook-merge .
# Railway：Root Directory 填 workers/audiobook-merge（勿用仓库根目录，否则会 COPY 错 package.json）。
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.mjs"]
