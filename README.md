# 小六壬 AI 占卜 – Cloudflare Pages / PWA

> 基于 **Cloudflare Pages Functions** + **AI 大模型** 的小六壬占卜 Web 应用，并支持离线访问（PWA）。

---

## 功能特性

| 特性 | 说明 |
|------|------|
| AI 流式解卦 | 后端以 **SSE** 推送推理过程与答案，前端无刷新实时渲染。 |
| PWA 离线支持 | 通过 `service-worker.js` + `manifest.json`，可一键安装至桌面（iOS / Android / 桌面浏览器）。 |
| 模块化占卜算法 | 将干支、卦象、时辰计算抽离至 `lib/` 目录，单元可独立复用。 |
| 云原生部署 | 使用 Cloudflare Pages，无需服务器运维，自动 HTTPS & CDN。 |

---

## 目录结构

| 路径 | 说明 |
|------|------|
| `index.html` | 前端静态页面（原生 JS + SSE + PWA 注册）。 |
| `service-worker.js` | **Cache-First** 服务工作线程，提供离线缓存。 |
| `manifest.json` | Web App Manifest，定义应用名称、图标、启动 URL 等。 |
| `functions/divination.js` | Cloudflare Pages Functions 入口，负责参数校验、业务编排与 AI 调用。 |
| `lib/` | 占卜核心算法模块：`ganzhi.js`、`hexagram.js`、`time.js`。 |
| `wrangler.toml` | Wrangler 配置文件。 |
| `.dev.vars` / `.dev.vars.example` | 本地环境变量文件（**勿提交 Git**，已在 `.gitignore` 中）。 |

---

## 前置条件

1. **Node.js ≥ 18**（仅用于安装 Wrangler CLI）。
2. **npm / pnpm / yarn**（任选其一）。
3. **Cloudflare 账号**，已开通 *Cloudflare Pages*。 
4. **AI 大模型 API Key**。

---

## 安装 Wrangler CLI

```powershell
npm install -g wrangler  # 或 pnpm add -g wrangler
```

> Wrangler 用于本地预览、调试与发布 Cloudflare Pages 项目。

---

## 配置环境变量

后端函数读取以下环境变量：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `API_KEY` | ✅ | 大模型 API Key，用于请求 `ENDPOINT`。 |
| `ENDPOINT` | ❌ | Chat Completion 端点，默认为 `https://api.openai.com/v1/chat/completions`。 |
| `MODEL` | ❌ | 模型名称，默认 `gpt-4o`。 |
| `SYSTEM_PROMPT` | ❌ | 系统提示词，可用于定制 AI 角色与回答风格。 |

### 本地开发

1. 复制示例文件：
   ```powershell
   cp .dev.vars.example .dev.vars
   ```
2. 编辑 `.dev.vars`，填入实际值：
   ```env
   API_KEY=sk-xxxxxxxx
   ENDPOINT=https://openrouter.ai/api/v1/chat/completions
   MODEL=openai/gpt-4o
   SYSTEM_PROMPT=你是一位精通小六壬的国学大师……
   ```

### 线上部署

在 Cloudflare Pages 控制台 *Settings → Environment Variables* 中添加同名变量即可。

---

## 本地开发与调试

```powershell
# 根目录启动本地开发服务器（默认端口 8788）
wrangler pages dev . --live-reload
```

- 修改静态文件或 Functions 代码后自动热更新。
- 浏览器访问 `http://localhost:8788` 体验完整功能（含 PWA 安装提示）。

### 调试 Pages Functions

- Wrangler 终端实时打印 `console.*` 与网络日志。
- VS Code 用户可安装 [Cloudflare Workers 插件](https://marketplace.visualstudio.com/items?itemName=cloudflare.cloudflare-workers) 进行断点调试。

---

## API 使用

### 1. 端点

```
POST /api/divination
Accept: text/event-stream
Content-Type: application/json
```

### 2. 请求体

```json
{
  "numbers": [3, 5, 2],           // 三个正整数
  "question": "今年事业如何？",    // 占卜问题
  "show_reasoning": true,        // 是否推送推理过程（默认 true）
  "apiKey": "...",              // 可覆盖全局 API_KEY
  "model": "openai/gpt-4o",     // 可覆盖全局 MODEL
  "endpoint": "https://...",    // 可覆盖全局 ENDPOINT
  "clientTime": {                // 可选，客户端本地时间
    "ts": 1718511692000,
    "tz_offset": -480
  }
}
```

### 3. SSE 事件流

| event | data 示例 | 说明 |
|-------|-----------|------|
| `meta` | `{ "hexagram": "大安 小吉 空亡", "time": "甲辰年 丙寅月 戊申日 甲子时" }` | 起卦结果与八字时间。 |
| `reasoning` | `正在分析第一卦…` | （可选）AI 推理过程。 |
| `answer` | `事业整体趋稳…` | 最终解卦内容（连续多帧）。 |
| `error` | `错误信息` | 异常提示。 |

---

## 部署到 Cloudflare Pages

> 支持 **Git 集成自动部署**（推荐）或 **本地 CLI 发布**。

### 1. Git 集成（CI/CD）

1. 将本项目推送至 GitHub/GitLab/Gitee。
2. 在 Cloudflare Pages 创建项目，选择对应仓库。
3. 构建参数：
   - **Production branch**：`main`（或实际分支）。
   - **Framework preset**：`None`。
   - **Build command**：留空（本项目无前端打包）。
   - **Build output directory**：`./`（项目根）。
4. 添加环境变量（参考上文）。
5. 保存后自动触发首次构建并部署。

### 2. 本地 CLI 发布

```powershell
wrangler pages publish . --project-name <YOUR_PROJECT_NAME>
```

- 首次发布会引导创建 Pages 项目。
- CLI 自动上传静态资源与 Functions 代码。

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| AI API `401 Unauthorized` | 检查 `API_KEY` 是否正确、未过期且已绑定环境变量。 |
| 浏览器 `Failed to fetch` | 查看 Wrangler 日志，确认后端未抛异常且网络可达。 |
| SSE 无数据或断流 | 确认浏览器未被代理/插件拦截；网络空闲时避免切到后台。 |
| PWA 无离线能力 | 清除浏览器缓存 & Service Worker，确认访问的是生产域名。 |

---

## 许可证

本项目源码以 [MIT License](LICENSE) 开源，商业使用请遵守条款。

---

🎉 欢迎 Issue / PR，与我们共同完善小六壬 AI 占卜！ 

# AI API 转发代理工具

基于 Cloudflare Pages Functions 的通用 AI API 转发代理工具，支持原样转发请求到各种AI供应商。

## 特性

- ✅ 通用AI API转发，支持原样透传请求
- ✅ 支持流式和非流式响应
- ✅ 支持CORS跨域请求
- ✅ 支持多种AI供应商（OpenAI、Claude、Gemini等）
- ✅ 无需系统提示词，完全透明转发
- ✅ 支持环境变量和请求参数混合配置
- ✅ 详细的错误处理和响应

## 部署说明

### 1. 环境变量配置

在 Cloudflare Pages 项目中设置以下环境变量：

```bash
# 必填：AI API密钥
API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxx

# 可选：默认模型名称
MODEL=gpt-4o

# 可选：默认API端点
ENDPOINT=https://api.openai.com/v1/chat/completions
```

### 2. 部署到 Cloudflare Pages

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 部署到生产环境
npm run deploy
```

## API 使用说明

### 端点

- `GET /api` - 获取API文档
- `POST /api` - 转发AI API请求
- `OPTIONS /api` - CORS预检请求

### 请求示例

#### 非流式请求

```bash
curl -X POST https://your-domain.pages.dev/api \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "model": "gpt-4o",
    "stream": false
  }'
```

#### 流式请求

```bash
curl -X POST https://your-domain.pages.dev/api \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Tell me a story"}
    ],
    "model": "gpt-4o", 
    "stream": true
  }'
```

#### 自定义API配置

```bash
curl -X POST https://your-domain.pages.dev/api \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello"}
    ],
    "model": "claude-3-sonnet-20240229",
    "stream": false,
    "apiKey": "your-custom-api-key",
    "endpoint": "https://api.anthropic.com/v1/messages"
  }'
```

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `messages` | Array | ✅ | 对话消息数组 |
| `model` | String | ❌ | AI模型名称 |
| `stream` | Boolean | ❌ | 是否使用流式响应（默认false） |
| `apiKey` | String | ❌ | API密钥（覆盖环境变量） |
| `endpoint` | String | ❌ | API端点（覆盖环境变量） |
| `...其他参数` | Any | ❌ | 会原样转发给AI供应商 |

### 响应格式

工具会原样返回AI供应商的响应，不做任何修改或处理。

#### 错误响应

```json
{
  "error": "错误描述信息"
}
```

## 支持的AI供应商

理论上支持所有兼容OpenAI API格式的AI供应商，包括但不限于：

- OpenAI (GPT-4, GPT-3.5等)
- Anthropic Claude
- Google Gemini
- 各种国产大模型API
- 自建模型API

## 安全说明

- 支持通过环境变量配置默认的API密钥和端点
- 支持在请求中临时覆盖配置
- 所有请求都会原样转发，不记录或修改内容
- 建议在生产环境中限制访问来源

## 许可证

MIT License 