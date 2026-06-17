# AI Town 在 WSL 下启动流程（Convex 云端 + 本地 Ollama）

> **给执行者：** 本文是一份**命令行运行手册（runbook）**，不是写代码的计划。按顺序逐条执行每一步，每步都给出了确切命令和预期输出。每个步骤用复选框（`- [ ]`）标记，便于追踪进度。

**目标：** 在 Windows 的 WSL2（Ubuntu）环境里，用 Convex 云端后端 + 本地 Ollama（完全免费、本地推理），把 AI Town 跑起来并能在浏览器访问。仅用于测试。

**整体思路：** WSL2 准备好 Node 18 环境 → 安装依赖 → 登录 Convex 创建云端部署 → 本机装 Ollama 并拉模型 → 用隧道把本地 Ollama 暴露给云端 → 设置 `OLLAMA_HOST` → `npm run dev` 同时启动前后端 → 浏览器访问并验证。

**技术栈：** WSL2 (Ubuntu) · Node.js 18 (via nvm) · Convex 云端后端 · Ollama 本地推理（chat: `llama3`，embedding: `mxbai-embed-large`，维度 1024）· ngrok/Tunnelmole 隧道 · Vite 前端。

---

## ⚠️ 必读：为什么需要隧道（关键前提）

你用的是 **Convex 云端后端**，而 Ollama 跑在你**本机**（`localhost:11434`）。云端的 Convex 服务器在 Anthropic/Convex 的机房里，**无法直接访问你电脑上的 `localhost`**。

所以这条路线必须额外做一件事：**用内网穿透隧道（ngrok 或 Tunnelmole）把本地 Ollama 的 11434 端口暴露成一个公网 URL**，再把这个 URL 设给 Convex 的 `OLLAMA_HOST` 环境变量。本手册的步骤 3 就是干这个的。

> **不想折腾隧道的替代方案：** 改用**自托管 Docker Compose 后端**（`docker compose up`），后端就在你本机，用 `host.docker.internal` 直连本地 Ollama，不需要公网隧道。如果你想走这条更"纯本地"的路，告诉我，我另出一份 Docker 版手册。本手册保持你之前选的 Convex 云端方案。

**关于嵌入维度：** 代码默认 `EMBEDDING_DIMENSION` 就是 Ollama 的 1024，**Ollama 路线不需要改任何代码**（见步骤 3.0 的校验）。

**前提准备：** 一个 Convex 账号（免费，登录时可用浏览器/GitHub 注册）。

---

## 关于项目路径的重要说明

项目目前位于 Windows 的 `d:\AI Agent\ai-town-web3`，在 WSL 里对应路径是：

```
/mnt/d/AI\ Agent/ai-town-web3
```

> ⚠️ 注意：在 `/mnt/d/...`（Windows 文件系统）下跑 Node 项目，文件 IO 会明显变慢。如果想要更流畅，可把项目复制到 WSL 原生目录（如 `~/ai-town`）再运行。本手册默认直接用 `/mnt/d` 路径；若已复制到 WSL 原生目录，把下面所有 `cd` 的目标路径换成你的新路径即可。

---

## 步骤 0：WSL2 环境准备（首次安装时做一次即可）

**说明：** 如果你之前已经在 WSL 里装好了 Node 18，可跳过本步骤，直接到步骤 1。

- [ ] **0.1 打开 WSL（Ubuntu）终端并更新包索引**

运行：
```bash
sudo apt update
```
预期：列出可升级的包，最后一行类似 `N packages can be upgraded.`，无报错。

- [ ] **0.2 安装 nvm（Node 版本管理器）**

运行：
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.2/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
source ~/.bashrc
```
预期：脚本输出 nvm 克隆信息；`source` 后无报错。

- [ ] **0.3 验证 nvm 可用**

运行：
```bash
command -v nvm
```
预期：输出 `nvm`。若输出为空，关闭并重新打开 WSL 终端再试一次。

- [ ] **0.4 安装并启用 Node.js 18**

运行：
```bash
nvm install 18
nvm use 18
```
预期：`Now using node v18.x.x (npm v...)`。

- [ ] **0.5 验证 Node 版本**

运行：
```bash
node -v
```
预期：输出 `v18.x.x`（必须是 18，其他版本可能报 Convex 启动错误）。

- [ ] **0.6 安装 Python（部分依赖需要）**

运行：
```bash
sudo apt-get install -y python3 python3-pip
sudo ln -sf /usr/bin/python3 /usr/bin/python
```
预期：安装完成，`python --version` 能输出 `Python 3.x.x`。

---

## 步骤 1：进入项目并安装依赖

- [ ] **1.1 进入项目目录**

运行：
```bash
cd "/mnt/d/AI Agent/ai-town-web3"
```
预期：无输出即成功（`pwd` 可确认在该目录）。

- [ ] **1.2 确认当前在项目根（能看到 package.json）**

运行：
```bash
ls package.json convex docker-compose.yml
```
预期：三项都列出，无 `No such file` 报错。

- [ ] **1.3 用 Node 18 安装依赖**

运行：
```bash
nvm use 18
npm install
```
预期：依赖安装完成，最后出现 `added N packages` 之类信息。可能有少量 warning，可忽略。

---

## 步骤 2：登录 Convex 并创建云端部署

**说明：** 第一次运行任何 `convex` 命令会引导你登录并创建一个云端项目；之后设置环境变量、部署都依赖这个部署。

- [ ] **2.1 启动 Convex 开发部署（首次会触发登录）**

运行：
```bash
npx convex dev
```
预期流程：
1. 提示登录 —— 会给出一个浏览器链接或设备码，按提示在浏览器完成登录/授权。
2. 询问创建新项目还是用已有项目 —— 选择创建新项目（按提示选择 a new project），给项目起个名字。
3. 部署函数，最后停在监听状态，出现类似 `Convex functions ready!` 并持续 watching。

- [ ] **2.2 让它先停下，准备做后续配置**

在该终端按 `Ctrl + C` 退出 watching（此时云端部署已创建好，凭据已写入本地 `.env.local`）。

预期：回到 shell 提示符。

- [ ] **2.3 确认本地已写入部署配置**

运行：
```bash
cat .env.local
```
预期：能看到 `CONVEX_DEPLOYMENT=...` 和 `VITE_CONVEX_URL=https://...convex.cloud` 这类条目。

---

## 步骤 3：配置本地 Ollama 作为 LLM（并用隧道暴露给云端）

**说明：** 这一步是本路线的核心。先确认无需改代码 → 安装 Ollama 并拉模型 → 启动隧道 → 把隧道 URL 设给 `OLLAMA_HOST`。

- [ ] **3.0 校验嵌入维度无需改动（应保持默认的 Ollama）**

在项目根运行：
```bash
grep -n "export const EMBEDDING_DIMENSION" convex/util/llm.ts
```
预期：输出 `7:export const EMBEDDING_DIMENSION: number = OLLAMA_EMBEDDING_DIMENSION;`
> 如果这里显示的是 `OPENAI_...` 或 `TOGETHER_...`，说明被改过，请改回 `OLLAMA_EMBEDDING_DIMENSION`：
> ```bash
> sed -i 's/EMBEDDING_DIMENSION: number = .*_EMBEDDING_DIMENSION;/EMBEDDING_DIMENSION: number = OLLAMA_EMBEDDING_DIMENSION;/' convex/util/llm.ts
> ```

- [ ] **3.1 在 Windows 上安装并启动 Ollama**

推荐在 **Windows 本机**安装 Ollama（最简单）：到 https://ollama.com/ 下载 Windows 安装包并安装。安装后它会自动在后台运行，监听 `http://localhost:11434`。

验证（在 Windows PowerShell 或 WSL 里都行）：
```bash
curl http://localhost:11434
```
预期：返回 `Ollama is running`。

> 若没自动启动，可在 PowerShell 运行 `ollama serve`。

- [ ] **3.2 拉取对话模型和嵌入模型**

在 Windows PowerShell（或任意能访问 ollama 的终端）运行：
```bash
ollama pull llama3
ollama pull mxbai-embed-large
```
预期：分别下载完成。`llama3` 是默认对话模型，`mxbai-embed-large` 是默认嵌入模型（维度 1024，与代码匹配）。

- [ ] **3.3 测试对话模型可用**

运行：
```bash
ollama run llama3
```
预期：进入交互对话，随便问一句能回答。测试完输入 `/bye` 退出。

- [ ] **3.4 安装并启动隧道（把本地 11434 暴露成公网 URL）**

**方式 A — ngrok（推荐，稳定）：** 先到 https://ngrok.com 注册并按官网指引安装 + `ngrok config add-authtoken <你的token>`，然后运行（注意必须加 `--host-header`，否则 Ollama 会返回 403）：
```bash
ngrok http 11434 --host-header="localhost:11434"
```
预期：输出一行 `Forwarding  https://xxxx-xx-xx.ngrok-free.app -> http://localhost:11434`，记下这个 `https://...` 公网地址。让这个窗口一直开着。

**方式 B — Tunnelmole（开源、免注册）：**
```bash
npm install -g tunnelmole
tmole 11434
```
预期：输出一个 `https://xxxx.tunnelmole.net` 公网地址，记下来。让窗口开着。

> ⚠️ 这个公网 URL 在每次重启隧道后通常会变，变了要重新执行步骤 3.5。

- [ ] **3.5 把隧道 URL 设给 Convex 的 OLLAMA_HOST**

回到 WSL 项目目录，把 `<你的隧道URL>` 换成上一步拿到的公网地址（结尾不要带斜杠）：
```bash
cd "/mnt/d/AI Agent/ai-town-web3"
npx convex env set OLLAMA_HOST '<你的隧道URL>'
```
例如：`npx convex env set OLLAMA_HOST 'https://xxxx.ngrok-free.app'`
预期：输出类似 `Successfully set OLLAMA_HOST` 的确认信息。

- [ ] **3.6（可选）自定义模型名**

不设则用默认 chat `llama3`、embedding `mxbai-embed-large`。如需自定义：
```bash
npx convex env set OLLAMA_MODEL 'llama3'
npx convex env set OLLAMA_EMBEDDING_MODEL 'mxbai-embed-large'
```
> ⚠️ 换嵌入模型会改变向量维度，必须与代码里的 `EMBEDDING_DIMENSION`（1024）一致，否则要改代码并清库重来。

- [ ] **3.7 确认环境变量已写入**

运行：
```bash
npx convex env list
```
预期：列表里能看到 `OLLAMA_HOST`（值为你的隧道 URL）。

---

## 步骤 4：启动项目（前端 + 后端一起跑）

**说明：** `npm run dev` 会先执行 `predev`（`convex dev --run init`，把地图/世界/角色初始化数据上传到云端，直到成功），然后并行启动后端（`convex dev --tail-logs`）和前端（`vite`）。

> ✅ 启动前请确保：Ollama 在跑（步骤 3.1）、隧道窗口开着（步骤 3.4）、`OLLAMA_HOST` 已设为当前隧道地址（步骤 3.5）。

- [ ] **4.1 启动**

运行：
```bash
nvm use 18
npm run dev
```
预期：
- 先看到 init 相关日志，初始化世界数据成功。
- 然后后端进入 watching，并打印 Convex 日志。
- 前端 Vite 启动，出现 `Local: http://localhost:5173/`。

> 让这个终端一直开着，它就是项目运行进程。停止用 `Ctrl + C`。

- [ ] **4.2（如需分开两个终端跑）替代方案**

终端 A（后端）：
```bash
npm run dev:backend
```
终端 B（前端）：
```bash
npm run dev:frontend
```
预期：分别进入后端 watching 和前端 Vite 服务。

---

## 步骤 5：访问并验证

- [ ] **5.1 浏览器打开前端**

在 Windows 浏览器访问：
```
http://localhost:5173
```
预期：看到 AI Town 的小镇地图，角色（agents）出现在地图上。

- [ ] **5.2 验证角色开始活动 / 对话**

观察页面上角色是否走动、是否产生对话气泡。

> ⏳ 本地 Ollama 推理比云端慢，首次对话可能要等较久（取决于你的 CPU/GPU）。可在隧道窗口和 `npm run dev` 的日志里看到对 Ollama 的请求。建议把 `convex/constants.ts` 里的 `NUM_MEMORIES_TO_SEARCH` 设为 `1` 以减小 prompt、加快速度。

- [ ] **5.3 若角色不动 / 引擎像没在跑，踢一下引擎**

新开一个 WSL 终端，进入项目目录后运行：
```bash
cd "/mnt/d/AI Agent/ai-town-web3"
npx convex run testing:kick
```
预期：返回成功，引擎/agents 恢复运行。

> 提示：窗口空闲 5 分钟后模拟会自动暂停，重新加载页面即可恢复；UI 上也有冻结/解冻按钮。

---

## 步骤 6：常用运维 / 调试命令（按需使用）

> 以下命令都在项目根目录、另开的 WSL 终端里运行（先 `cd "/mnt/d/AI Agent/ai-town-web3"`）。

- [ ] **停止后端引擎（活动太多时减负，仍可查询调试）**
```bash
npx convex run testing:stop
```

- [ ] **停止后重新启动后端引擎**
```bash
npx convex run testing:resume
```

- [ ] **引擎/agents 没跑起来时踢一下**
```bash
npx convex run testing:kick
```

- [ ] **归档当前世界（重置但保留数据可在 dashboard 查看）**
```bash
npx convex run testing:archive
```

- [ ] **创建一个全新世界**
```bash
npx convex run init
```

- [ ] **打开 Convex Dashboard（查看数据/日志/函数）**
```bash
npm run dashboard
```
预期：输出 dashboard 链接，浏览器打开可看部署数据。

- [ ] **彻底清库重来（⚠️ 会删除所有数据！）**
```bash
npx convex run testing:wipeAllTables
npx convex run init
```
> 修改了角色数据（`data/characters.ts`）或切换了 LLM/嵌入模型后，需要先 wipe 再重新 `npm run dev`，否则维度/数据不一致。

---

## 自检清单（执行前快速核对）

1. **Node 版本**：`node -v` 必须是 `v18.x.x`。
2. **嵌入维度**：`convex/util/llm.ts` 第 7 行保持默认的 `OLLAMA_EMBEDDING_DIMENSION`（无需改代码）。
3. **Ollama 在跑**：`curl http://localhost:11434` 返回 `Ollama is running`，且已 `ollama pull llama3` 和 `mxbai-embed-large`。
4. **隧道开着**：ngrok/Tunnelmole 窗口在运行，拿到了公网 URL。
5. **环境变量**：`npx convex env list` 能看到 `OLLAMA_HOST` 且值为当前隧道 URL。
6. **登录**：`.env.local` 里有 `CONVEX_DEPLOYMENT` 和 `VITE_CONVEX_URL`。
7. **访问地址**：`http://localhost:5173`。

## 常见问题速查

- **角色不说话/不动** → 先 `npx convex run testing:kick`；再检查：Ollama 是否在跑、隧道是否还活着、`OLLAMA_HOST` 是否是**当前**隧道 URL（隧道重启后 URL 会变，要重设）。
- **Convex 日志报连接 Ollama 失败 / 超时** → 99% 是隧道问题：URL 变了没重设、或隧道窗口关了、或 ngrok 没加 `--host-header="localhost:11434"` 导致 403。
- **报维度不匹配 / `EMBEDDING_DIMENSION` 相关错误** → 确认第 7 行是 `OLLAMA_EMBEDDING_DIMENSION`，且没把嵌入模型换成非 1024 维的。改过要 `wipeAllTables` 后重来。
- **Convex 启动报 node 版本错误** → 没用 Node 18，运行 `nvm use 18` 后重开 `npm run dev`。
- **本地推理太慢** → 把 `convex/constants.ts` 的 `NUM_MEMORIES_TO_SEARCH` 设为 `1`；或换更小/更快的模型；有 GPU 会快很多。
- **不想用隧道** → 改用自托管 Docker Compose 后端（见本文顶部"替代方案"），让我另出一份 Docker 版手册。
