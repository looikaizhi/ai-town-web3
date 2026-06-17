# AI Town 在 WSL 下启动流程（Docker 自托管后端 + 本地 Ollama）

> **给执行者：** 本文是一份**命令行运行手册（runbook）**，不是写代码的计划。按顺序逐条执行每一步，每步都给出了确切命令和预期输出。每个步骤用复选框（`- [ ]`）标记，便于追踪进度。

**目标：** 在 Windows 的 WSL2 环境里，用 **Docker 自托管 Convex 后端** + 本地 Ollama，把 AI Town 跑起来。**全程不需要任何公网隧道**，也不需要 Convex 账号——这是纯本地测试最省心的方案。

**整体思路：** 准备 Docker + Node 18 → 用 `docker compose` 起前端/后端/dashboard 三个容器 → 生成 admin key 写入 `.env.local` → 本机装 Ollama 并让它监听 `0.0.0.0` → 让后端容器用 `host.docker.internal` 直连 Ollama → 初始化世界并部署函数 → 浏览器访问。

**技术栈：** WSL2 (Ubuntu) · Docker Compose · 自托管 Convex 后端（容器）· Node.js 18（宿主机跑 convex CLI 用）· Ollama 本地推理（chat: `llama3`，embedding: `mxbai-embed-large`，维度 1024）· Vite 前端（容器）。

---

## 这套方案为什么不需要隧道

后端（Convex）这次跑在你**本机的 Docker 容器**里，而不是云端。容器通过 Docker 提供的 `host.docker.internal` 主机名就能访问到宿主机上的 Ollama。所以**完全不存在**云端连不到 localhost 的问题，也就告别了 ngrok 的 `<!DOCTYPE html>` 报错。

**唯一的关键点（一定要做）：** Ollama 默认只监听 `127.0.0.1`，Docker 容器连不进去。必须让 Ollama 监听 `0.0.0.0`，容器才能通过 `host.docker.internal` 访问。步骤 5 会处理这件事。

> ⚠️ **命名陷阱：** 有两个都叫 `OLLAMA_HOST` 的东西，别搞混：
> - **Ollama 服务端的 `OLLAMA_HOST`**（在 Windows 上设）：控制 Ollama **监听哪个地址**，要设成 `0.0.0.0:11434`。
> - **Convex 的 `OLLAMA_HOST`**（用 `npx convex env set` 设）：告诉后端**去哪连** Ollama，要设成 `http://host.docker.internal:11434`。

---

## 前提准备

- **Docker Desktop**（Windows 版，并开启 WSL2 集成）已安装并运行。验证：在 WSL 里 `docker version` 能正常输出 client+server。
- 不需要 Convex 账号，不需要 OpenAI key。

## 关于项目路径

项目在 `d:\AI Agent\ai-town-web3`，WSL 路径为 `/mnt/d/AI Agent/ai-town-web3`。
> ⚠️ `/mnt/d` 下 IO 较慢；想更流畅可把项目复制到 WSL 原生目录（如 `~/ai-town`），并把下文所有 `cd` 路径替换掉。

---

## 步骤 0：环境准备（首次做一次）

- [ ] **0.1 验证 Docker 在 WSL 里可用**

运行：
```bash
docker version
docker compose version
```
预期：都能输出版本号，`docker version` 里 Server 部分不报错。若报错，去 Docker Desktop 设置里开启对应 WSL 发行版的集成，并确保 Docker Desktop 正在运行。

- [ ] **0.2 准备 Node 18（宿主机跑 convex CLI 需要）**

运行：
```bash
nvm use 18 || nvm install 18
node -v
```
预期：输出 `v18.x.x`。（若没装 nvm，参考另一份手册的步骤 0.2 先装 nvm。）

---

## 步骤 1：进入项目并安装宿主机依赖

- [ ] **1.1 进入项目目录**

运行：
```bash
cd "/mnt/d/AI Agent/ai-town-web3"
```
预期：无输出即成功。

- [ ] **1.2 安装依赖（宿主机用 `npx convex ...` 命令需要）**

运行：
```bash
nvm use 18
npm install
```
预期：`added N packages`。
> 容器内有自己独立的 node_modules，这里装的是给宿主机 convex CLI 用的。

- [ ] **1.3 校验嵌入维度为默认的 Ollama（无需改代码）**

运行：
```bash
grep -n "export const EMBEDDING_DIMENSION" convex/util/llm.ts
```
预期：`7:export const EMBEDDING_DIMENSION: number = OLLAMA_EMBEDDING_DIMENSION;`
> 若不是，改回来：`sed -i 's/EMBEDDING_DIMENSION: number = .*_EMBEDDING_DIMENSION;/EMBEDDING_DIMENSION: number = OLLAMA_EMBEDDING_DIMENSION;/' convex/util/llm.ts`

---

## 步骤 2：用 Docker Compose 启动三个容器

- [ ] **2.1 构建并后台启动**

运行：
```bash
docker compose up --build -d
```
预期：首次会拉镜像 + 构建前端镜像（较慢），最后三个服务 `frontend / backend / dashboard` 都为 started。

- [ ] **2.2 确认容器都在跑**

运行：
```bash
docker compose ps
```
预期：`frontend`(5173)、`backend`(3210/3211/11434)、`dashboard`(6791) 状态都是 Up，backend 健康检查 healthy。

> 端口说明：前端 http://localhost:5173 ，后端 http://localhost:3210 （http api 3211），dashboard http://localhost:6791 。

---

## 步骤 3：生成 admin key 并写入 .env.local

**说明：** 自托管后端需要一个 admin key，宿主机的 convex CLI 和 dashboard 都靠它来操作这个本地部署。

- [ ] **3.1 生成 admin key**

运行：
```bash
docker compose exec backend ./generate_admin_key.sh
```
预期：输出一长串 admin key，**完整复制下来**（含可能的 `convex-self-hosted|...` 前缀）。

- [ ] **3.2 把两行配置写入 `.env.local`**

编辑项目根的 `.env.local`（没有就新建），加入这两行，把 `<admin-key>` 换成上一步的 key（**务必保留引号**）：
```
CONVEX_SELF_HOSTED_ADMIN_KEY="<admin-key>"
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3210"
```

可用命令追加（把 `PASTE_KEY_HERE` 换成你的 key）：
```bash
cat >> .env.local <<'EOF'
CONVEX_SELF_HOSTED_ADMIN_KEY="PASTE_KEY_HERE"
CONVEX_SELF_HOSTED_URL="http://127.0.0.1:3210"
EOF
```
预期：`.env.local` 里能看到这两行。

> ⚠️ 如果之后你 `docker compose down` 再 `up`，admin key 会重新生成，需要重做 3.1–3.2。

---

## 步骤 4：在 Windows 上安装并配置 Ollama（监听 0.0.0.0）

- [ ] **4.1 安装 Ollama（Windows 本机）**

到 https://ollama.com/ 下载 Windows 安装包并安装。

- [ ] **4.2 让 Ollama 监听所有网卡（容器才连得进来）**

在 **Windows PowerShell** 里设置系统环境变量并重启 Ollama：
```powershell
setx OLLAMA_HOST "0.0.0.0:11434"
```
然后**完全退出** Ollama（任务栏右键 Quit），再重新启动 Ollama（开始菜单打开，或 PowerShell 运行 `ollama serve`）。

预期：重启后 Ollama 监听在 `0.0.0.0:11434`。
> 这一步是本方案成败关键。不设的话 Ollama 只听 `127.0.0.1`，Docker 容器无法访问。

- [ ] **4.3 拉取对话模型和嵌入模型（Windows PowerShell）**

```powershell
ollama pull llama3
ollama pull mxbai-embed-large
```
预期：两个模型都下载完成。

- [ ] **4.4 从后端容器内测试能否连到 Ollama（最关键的验证）**

在 WSL 项目目录运行：
```bash
docker compose exec backend curl http://host.docker.internal:11434
```
预期：返回 `Ollama is running`。
> 若连不上，见文末「常见问题」的 socat 兜底方案。

---

## 步骤 5：把 Ollama 地址告诉 Convex 后端

- [ ] **5.1 设置 Convex 的 OLLAMA_HOST**

在 WSL 项目目录运行：
```bash
npx convex env set OLLAMA_HOST http://host.docker.internal:11434
```
预期：`Successfully set OLLAMA_HOST`。
> 这条命令通过 `.env.local` 里的 self-hosted 配置，作用在你本地 Docker 后端上。

- [ ] **5.2（可选）自定义模型名**

不设则默认 chat `llama3`、embedding `mxbai-embed-large`：
```bash
npx convex env set OLLAMA_MODEL llama3
npx convex env set OLLAMA_EMBEDDING_MODEL mxbai-embed-large
```
> ⚠️ 换嵌入模型需维度仍为 1024，否则要改代码并清库。

- [ ] **5.3 确认环境变量已写入**

```bash
npx convex env list
```
预期：能看到 `OLLAMA_HOST = http://host.docker.internal:11434`。

---

## 步骤 6：初始化世界并部署函数

**说明：** `predev` 会跑 `convex dev --run init --until-success`，把地图/世界/角色初始化数据写进本地后端，直到成功。

- [ ] **6.1 一次性初始化后端**

运行：
```bash
npm run predev
```
预期：连接到本地自托管后端，部署函数并跑 init 成功，结束后退出。

- [ ] **6.2 持续部署代码并查看日志**

运行：
```bash
npm run dev:backend
```
预期：进入 watching，持续把 convex 函数改动推到后端容器，并打印后端日志（包括对 Ollama 的调用）。

> 让这个终端开着。前端不用你手动起——它已经在 `frontend` 容器里跑着了。

---

## 步骤 7：访问并验证

- [ ] **7.1 打开前端**

浏览器访问：
```
http://localhost:5173
```
预期：看到小镇地图和角色。

- [ ] **7.2 验证角色活动 / 对话**

观察角色是否走动、产生对话气泡。
> ⏳ 本地 Ollama 推理较慢，首次对话可能要等较久。在步骤 6.2 的日志里能看到对 Ollama 的请求。建议把 `convex/constants.ts` 的 `NUM_MEMORIES_TO_SEARCH` 设为 `1` 以加快速度。

- [ ] **7.3 引擎没动就踢一下**

另开 WSL 终端：
```bash
cd "/mnt/d/AI Agent/ai-town-web3"
npx convex run testing:kick
```
预期：成功，引擎/agents 恢复。

- [ ] **7.4（可选）登录 Dashboard 看数据**

浏览器访问 `http://localhost:6791`，填入：
- Deployment URL：`http://127.0.0.1:3210`
- Admin key：步骤 3.1 生成的 key

预期：能浏览表数据、日志、函数。

---

## 步骤 8：常用运维 / 调试命令

> 容器生命周期（在项目目录运行）：

- [ ] **停止容器（保留数据）**
```bash
docker compose stop
```
- [ ] **重新启动容器**
```bash
docker compose start
```
- [ ] **彻底销毁容器（⚠️ admin key 会失效，需重做步骤 3）**
```bash
docker compose down
```
- [ ] **进入某个容器排查**
```bash
docker compose exec backend /bin/bash   # 退出用 exit
```

> 游戏引擎控制（另开 WSL 终端，先 cd 到项目目录）：

- [ ] **停止引擎** `npx convex run testing:stop`
- [ ] **恢复引擎** `npx convex run testing:resume`
- [ ] **踢引擎** `npx convex run testing:kick`
- [ ] **归档世界** `npx convex run testing:archive`
- [ ] **新建世界** `npx convex run init`
- [ ] **清库重来（⚠️ 删除所有数据）**
```bash
npx convex run testing:wipeAllTables
npx convex run init
```

---

## 自检清单（执行前快速核对）

1. **Docker** 在跑：`docker compose ps` 三个容器都 Up、backend healthy。
2. **嵌入维度**：`convex/util/llm.ts` 第 7 行是 `OLLAMA_EMBEDDING_DIMENSION`（无需改）。
3. **admin key**：`.env.local` 里有 `CONVEX_SELF_HOSTED_ADMIN_KEY` 和 `CONVEX_SELF_HOSTED_URL`。
4. **Ollama 监听 0.0.0.0**：`docker compose exec backend curl http://host.docker.internal:11434` 返回 `Ollama is running`。
5. **模型已拉**：`ollama list` 里有 `llama3` 和 `mxbai-embed-large`。
6. **Convex OLLAMA_HOST**：`npx convex env list` 显示 `http://host.docker.internal:11434`。
7. **访问地址**：前端 `http://localhost:5173`，dashboard `http://localhost:6791`。

## 常见问题速查

- **`docker compose exec backend curl host.docker.internal:11434` 连不上 Ollama** → 99% 是 Ollama 没监听 `0.0.0.0`（步骤 4.2 没做或没重启 Ollama）。Windows 防火墙也可能拦，放行 11434。
  - 兜底（用 socat 在容器里转发到宿主机真实 IP）：
    ```bash
    docker compose exec backend /bin/bash
    HOST_IP=<你的Windows局域网IP>
    socat TCP-LISTEN:11434,fork TCP:$HOST_IP:11434 &
    ```
    然后 `npx convex env set OLLAMA_HOST http://localhost:11434`。
- **角色不说话/不动** → `npx convex run testing:kick`；确认 Ollama 在跑、模型已拉、步骤 4.4 的连通性测试通过。
- **`npx convex ...` 报未配置部署 / 连不上** → 检查 `.env.local` 的 `CONVEX_SELF_HOSTED_URL` 和 `CONVEX_SELF_HOSTED_ADMIN_KEY` 是否正确；`down` 过要重新生成 admin key。
- **维度不匹配错误** → 第 7 行必须是 `OLLAMA_EMBEDDING_DIMENSION`，且嵌入模型为 1024 维；改过要 `wipeAllTables` 重来。
- **改了 convex 函数没生效** → 确认 `npm run dev:backend` 还在 watching。
- **本地推理太慢** → `NUM_MEMORIES_TO_SEARCH` 设为 `1`；或用更小模型；有 GPU 会快很多。
