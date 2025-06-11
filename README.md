# 六爻 AI 占卜 – Cloudflare Pages 项目

> 利用 Cloudflare Pages Functions + OpenRouter AI 实现的六爻占卜 Web 应用。

---

## 目录结构

| 路径 | 说明 |
|------|------|
| `index.html` | 前端静态页面，使用原生 JavaScript + SSE 渲染 AI 推理与解答 |
| `functions/` | Cloudflare Pages Functions 目录，包含 `divination.js` 后端逻辑 |
| `wrangler.toml` | Wrangler 配置文件 |
| `.dev.vars` / `.dev.vars.example` | 本地开发用环境变量文件（**不应提交到 Git**，已在 `.gitignore` 中） |

---

## 前置条件

1. **Node.js ≥ 18** （仅用于安装 Wrangler CLI）。
2. **npm / pnpm / yarn**（任选其一）。
3. **Cloudflare 账号**，已开通 *Cloudflare Pages*。
4. **OpenRouter API Key**（用于调用 Claude 4）。

---

## 安装 Wrangler CLI

```powershell
npm install -g wrangler  # 或 pnpm add -g wrangler
```

> Wrangler 用于本地预览与部署 Cloudflare Pages 项目。

---

## 配置环境变量

后端函数需要读取下列环境变量：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API Key，用于向 `https://openrouter.ai` 发起请求 |
| `SYSTEM_PROMPT` | ❌ | 可选系统提示词，用于控制 AI 角色 & 风格 |

### 本地开发

1. 复制示例文件：
   ```powershell
   cp .dev.vars.example .dev.vars
   ```
2. 编辑 `.dev.vars` 填入实际值：
   ```env
   OPENROUTER_API_KEY=sk-xxxxxxxx
   SYSTEM_PROMPT=你是一位精通周易的国学大师……
   ```

### 线上部署

在 Cloudflare Pages 控制台 *Settings → Environment Variables* 中添加同名变量即可。

---

## 本地开发与调试

1. 进入项目根目录。
2. 运行以下命令启动本地开发服务器（默认端口 `8788`）：
   ```powershell
   wrangler pages dev . --live-reload
   ```
   - `--live-reload`：修改静态文件或 Functions 代码后自动热更新。
3. 打开浏览器访问 `http://localhost:8788` 即可交互。

### 调试 Pages Functions

- Wrangler 会打印 Functions 请求日志与 `console.*` 输出，便于定位问题。
- 若需使用断点调试，可在 VSCode 中安装 [_Cloudflare Workers](https://marketplace.visualstudio.com/items?itemName=cloudflare.cloudflare-workers) 插件并附加到本地 Runtime。

---

## 部署到 Cloudflare Pages

> 支持 **自动（CI/CD）** 或 **手动（本地 CLI）** 两种方式。

### 1. Git 集成自动部署（推荐）

1. 将本项目推送到 GitHub / GitLab / Gitee 等代码仓库。
2. 在 Cloudflare Pages 新建项目，选择对应仓库。
3. 配置参数：
   - **Production branch**：`main`（或您实际使用的分支）。
   - **Framework preset**：`None`。
   - **Build command**：留空（本项目无前端打包步骤）。
   - **Build output directory**：`./` （根目录）。
4. 添加环境变量（参考前文）。
5. 保存后即触发首轮构建，成功后可访问生产域名。

> **Tips**：后续每次推送到 Production branch 将自动触发重新部署。

### 2. 本地手动发布

```powershell
wrangler pages publish . --project-name <YOUR_PROJECT_NAME>
```

- 若首次发布，Wrangler 会引导您新建 Pages 项目。
- CLI 会自动上传静态资源及 Functions 代码。

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| Chat API 返回 `401 Unauthorized` | 请检查 `OPENROUTER_API_KEY` 是否正确、未过期，且已正确绑定到 Cloudflare 变量 |
| 浏览器控制台出现 `Failed to fetch` | 确认后端函数未抛出异常；在本地终端查看 Wrangler 日志定位 |
| 无法在本地收发 SSE | 使用 Chrome/Edge 最新版本；确保未被公司代理或浏览器插件拦截 |

---

## 许可证

项目源码基于 [MIT License](LICENSE) 开源，商业使用请遵守条款。

---

祝使用愉快，更多问题欢迎提 Issue！ 