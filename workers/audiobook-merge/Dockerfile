FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Build from repo root: docker build -f workers/audiobook-merge/Dockerfile .
COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.mjs"]
