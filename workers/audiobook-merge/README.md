# 有声书合成 Worker（ffmpeg + R2）

供 **Vercel 等无 ffmpeg** 的环境使用：主站 API 在设置 `MERGE_VIDEO_AUDIO_WORKER_URL` 后将请求转发到本服务，由容器内 ffmpeg 合成并上传 **与主站相同的 R2 桶**，返回公网 `url`。

## Railway 部署（推荐：连 GitHub，无需手动 docker push）

1. 把本仓库推到 **GitHub**（或 Railway 支持的 Git 源）。
2. 打开 [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → 选中仓库。
3. 创建服务后打开 **Settings**：
   - **Root Directory** 留空（或填 `/`，表示 **整个仓库根**）。Railway 有时仍把 Docker 上下文放在仓库根；若填 `workers/audiobook-merge` 却出现 `server.mjs: not found`，就是上下文与 `COPY` 路径不一致导致。
   - Build 选 **Dockerfile**，**Dockerfile 路径**填：`workers/audiobook-merge/Dockerfile`（相对仓库根）。
4. **Variables** 里配置与本地 `docker run -e` 相同的环境变量（见下表），并确认：
   - Railway 会注入 **`PORT`**，本服务已读 `process.env.PORT`，无需手写 `8080`。
   - 若设了 **`WORKER_SECRET`**，主站 `MERGE_VIDEO_AUDIO_WORKER_SECRET` 须一致。
5. 部署成功后，在 **Networking** → **Generate Domain**，得到公网地址，例如 `https://xxx.up.railway.app`。
6. 主站（Vercel / 自建）设置：  
   `MERGE_VIDEO_AUDIO_WORKER_URL` = `https://xxx.up.railway.app/merge`  
   （末尾必须是 **`/merge`**，与 `server.mjs` 路由一致。）
7. 浏览器访问 `https://xxx.up.railway.app/health` 应返回 `ok`。

**可选：用镜像仓库部署**（不连 GitHub 时）：本地 `docker build` / `docker tag` / `docker push` 到 Docker Hub 或 GHCR，在 Railway **New** → **Docker Image** 填镜像地址，同样配置环境变量与端口。

---

## 部署示例（Fly.io / Railway / Render / 自建 Docker）

```bash
# 在仓库根目录执行（构建上下文 = 仓库根，与 Railway 一致）
docker build -f workers/audiobook-merge/Dockerfile -t audiobook-merge .
docker run -p 8080:8080 \
  -e R2_ACCOUNT_ID=83532292f8418edb405742e2052dde92 \
  -e R2_ACCESS_KEY_ID=7b633ea59ea9bc0d8d4d97d0ac6c4f17 \
  -e R2_SECRET_ACCESS_KEY=7dc60337035f8e81b60b843424bc5bf115f58ebcb09cc3c95f204b1e3dd98849 \
  -e R2_BUCKET_NAME=aiaudiotools \
  -e R2_UPLOAD_PATH=uploads \
  -e R2_PUBLIC_DOMAIN=https://r2.storycreater.com \
  -e MERGE_DOWNLOAD_REWRITE_HOSTS=r2.storycreater.com \
  audiobook-merge
```

#-e WORKER_SECRET="e84e2fc56850b57e919fe4174743da93b978906ab27a574b64ae97ff25f64830"\

- **R2\_\***：与 ShipAny 后台/数据库里配置的 R2 一致，保证上传路径与主站 `r2_upload_path` 相同，浏览器才能用同一域名访问。
- **WORKER_SECRET**：可选；若设置，主站必须配置相同的 `MERGE_VIDEO_AUDIO_WORKER_SECRET`。

## 与 Vercel 主站配合（推荐）

**不要把本 Worker 部署成 Vercel 的 Serverless Function**：和主站 API 一样，默认运行时里没有 ffmpeg，也无法在函数里稳定挂载完整 ffmpeg 二进制。正确做法是：

1. **在别处部署本目录的 Docker**（任选其一即可）  
   - [Railway](https://railway.app)：连 GitHub 后 Build 用 Dockerfile，路径 `workers/audiobook-merge/Dockerfile`，**Root Directory 用仓库根**（见上文），填好 R2 / `WORKER_SECRET` 等环境变量。  
   - [Fly.io](https://fly.io)、[Render](https://render.com) 等：同样用本目录 `Dockerfile` 构建，暴露端口 **8080**，配置环境变量。

2. **记下 Worker 对外地址**  
   必须能访问合并接口，例如：`https://xxx.up.railway.app/merge`（注意路径末尾是 **`/merge`**，与 `server.mjs` 一致）。

3. **在 Vercel 只配置环境变量（连接已有 Worker）**  
   - 打开 Vercel 控制台 → 你的 **Next 主项目** → **Settings** → **Environment Variables**  
   - 新增：  
     - `MERGE_VIDEO_AUDIO_WORKER_URL` = 上一步的完整 URL（含 `/merge`）  
     - `MERGE_VIDEO_AUDIO_WORKER_SECRET` = 与 Worker 上 `WORKER_SECRET` 相同的随机字符串（若 Worker 未设 `WORKER_SECRET` 可省略）  
   - 作用域勾选 **Production**（以及需要的话 **Preview**）  
   - 到 **Deployments** 里对最新部署 **Redeploy**，使新变量生效。

这样：**网站仍在 Vercel**，**合成只在带 ffmpeg 的 Worker 上执行**，主站通过服务端转发调用，浏览器不直连 Worker。

### Vercel 主站环境变量一览

| 变量 | 说明 |
|------|------|
| `MERGE_VIDEO_AUDIO_WORKER_URL` | Worker 的 `POST /merge` 完整 URL |
| `MERGE_VIDEO_AUDIO_WORKER_SECRET` | 可选；与 Worker 的 `WORKER_SECRET` 一致 |

未设置 `MERGE_VIDEO_AUDIO_WORKER_URL` 时，主站仍在 **当前 Node 进程**里跑 ffmpeg（仅适合本机或自带 ffmpeg 的 Docker 主机，不适合默认 Vercel Serverless）。

## 接口约定

`POST /merge`，`Content-Type: application/json`：

```json
{ "videoUrl": "https://...", "audioUrl": "https://..." }
```

成功：`200`，`{ "url": "https://..." }`  
失败：`4xx/5xx`，`{ "error": "..." }`

主站已在转发前把相对 URL 解析为绝对地址，Worker 只需能 **公网访问** 这两个链接。
