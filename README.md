# 云占小六壬 – Cloudflare Workers / PWA

> 基于 **Cloudflare Workers** ✕ **AI 大模型** 的在线占卜应用，并提供离线访问（PWA）。

---

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| AI 流式解卦 | 后端以 **SSE** 推送推理过程及答案，前端实时渲染，毫秒级延迟。 |
| 零运维部署 | 部署至 Cloudflare Workers，全球百毫秒访问，无需服务器运维。 |
| PWA 离线支持 | 通过 `service-worker.js` + `manifest.json`，可一键安装到桌面 / 手机。 |
| 模块化算法 | 干支、卦象、时辰计算均拆分至 `lib/`，逻辑清晰、易维护。 |

---

## 🗂️ 目录结构

| 路径 | 说明 |
|------|------|
| `worker.js` | Cloudflare Worker 入口，实现 API 路由 + 静态资源服务。 |
| `static/` | 前端静态资源目录（HTML / CSS / JS / 图标 …）。 |
| `lib/` | 占卜核心算法模块。 |
| `wrangler.toml` | Wrangler 配置文件。 |
| `.wranglerignore` | 部署忽略规则，避免上传无关文件。 |
| `.dev.vars` / `.dev.vars.example` | 本地环境变量文件 (**勿提交 Git**，已在 `.gitignore` 中)。 |

---

## ⚙️ 先决条件

1. **Node.js ≥ 18**（仅用于安装/运行 Wrangler）。
2. **npm / pnpm / yarn**（任选其一）。
3. **Cloudflare 账号**，已开通 Workers。  
4. **AI 大模型 API Key**（OpenAI / OpenRouter 等）。

---

## 🚀 快速开始

### 1. 安装 Wrangler CLI

```powershell
npm i -g wrangler   # 或 pnpm add -g wrangler
```

### 2. 克隆仓库

```powershell
git clone https://github.com/<your>/<repo>.git
cd <repo>
```

### 3. 配置环境变量

```powershell
cp .dev.vars.example .dev.vars   # Windows 用户使用 copy
```

编辑 `.dev.vars`：

```env
API_KEY=sk-xxxxxxxxxxxxxxxx
ENDPOINT=https://api.openai.com/v1/chat/completions
MODEL=gpt-4o
SYSTEM_PROMPT=你是一位精通小六壬的国学大师……
```

> 线上部署时，在 Cloudflare 控制台 **Workers → Settings → Variables** 中添加同名变量即可。

### 4. 本地开发

```powershell
# 使用本地模拟器运行（端口 8787）
npm run dev         # 实际执行：wrangler dev --local
```

打开浏览器访问 <http://localhost:8787> 即可体验完整功能（含 PWA 安装提示）。

---

## 🌐 API 说明

### 端点

```
POST /api/divination
Accept: text/event-stream
Content-Type: application/json
```

### 请求体

```json5
{
  "numbers": [3, 5, 2],          // 三个正整数
  "question": "今年事业如何？",   // 待占卜问题
  "show_reasoning": true,       // 是否推送推理过程（默认 true）
  "apiKey": "...",            // 可覆盖全局 API_KEY
  "model": "openai/gpt-4o",   // 可覆盖全局 MODEL
  "endpoint": "https://...",  // 可覆盖全局 ENDPOINT
  "clientTime": {               // 可选，客户端本地时间
    "ts": 1718511692000,
    "tz_offset": -480
  }
}
```

### SSE 事件流

| event | data 示例 | 说明 |
|-------|-----------|------|
| `meta` | `{ "hexagram": "大安 小吉 空亡", "time": "甲辰年 丙寅月 戊申日 甲子时" }` | 起卦结果 + 八字时间 |
| `reasoning` | `正在分析第一卦…` | （可选）AI 推理过程 |
| `answer` | `事业整体趋稳…` | 最终解卦内容（连续多帧） |
| `error` | `错误信息` | 异常提示 |

---

## 🛠️ 常用脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 本地开发 (Workers 模拟器) |
| `npm run dev:remote` | 远程开发，直接在 Cloudflare 边缘运行 |
| `npm run deploy` | 发布到生产环境 |

---

## ☁️ 部署到 Cloudflare Workers

```powershell
npm run deploy     # 等价于：wrangler deploy
```

部署完成后，Wrangler 会输出 Workers URL，例如 `https://yunzhan-xiaoliuren.<subdomain>.workers.dev`，也可绑定自定义域名。

---

## ❓ 常见问题

| 问题 | 解决方案 |
|------|----------|
| `401 Unauthorized` | 检查 `API_KEY` 是否正确、未过期且已绑定环境变量。 |
| `Failed to fetch` | 查看 Wrangler 日志 (`wrangler tail`)，确认后端未抛异常，网络可达。 |
| SSE 无数据 / 断流 | 确认浏览器未被代理/插件拦截；切后台会被浏览器节流，建议保持当前标签页激活。 |
| PWA 离线失效 | 清除浏览器缓存 & Service Worker，然后重新访问生产域名。 |

---

## 📄 许可证

本项目源码以 **MIT License** 开源，商业使用请遵守条款。

---

> 🎉 欢迎 Issue / PR，与我们一同完善 “云占小六壬”！ 