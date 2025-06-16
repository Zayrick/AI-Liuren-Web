# Cloudflare Pages 到 Workers 迁移说明

## 迁移概述

本项目已从 **Cloudflare Pages Functions** 架构迁移到 **Cloudflare Workers** 架构。

## 主要变更

### 1. 架构变更
- **之前**: Cloudflare Pages Functions (`functions/divination.js`)
- **现在**: Cloudflare Worker (`worker.js`)

### 2. 配置文件变更
- `wrangler.toml`: 移除 Pages 配置，添加 Worker 配置和静态资产绑定
- `package.json`: 更新脚本命令，支持 Worker 开发和部署

### 3. 文件结构变更
```
项目根目录/
├── worker.js              # 🆕 Worker 主入口文件
├── wrangler.toml           # 🔧 更新为 Worker 配置
├── package.json            # 🔧 更新脚本命令
├── functions/              # ⚠️  保留但不再使用
│   └── divination.js
├── lib/                    # ✅ 继续使用的业务逻辑模块
│   ├── hexagram.js
│   ├── time.js
│   └── ganzhi.js
├── assets/                 # ✅ 静态资产（CSS、JS）
├── index.html              # ✅ 主页面
└── ...其他静态文件
```

### 4. API 路径变更
- **之前**: `/divination`（Pages Functions 自动路由）
- **现在**: `/api/divination`（Worker 中明确定义）

## 部署指令

### 开发环境
```bash
# 本地开发（使用模拟环境）
npm run dev

# 远程开发（使用 Cloudflare 开发环境）
npm run dev:remote
```

### 生产部署
```bash
npm run deploy
```

## 环境变量配置

在 `wrangler.toml` 中配置或使用 Cloudflare Dashboard：

```toml
[vars]
API_KEY = "your-ai-api-key"
MODEL = "gpt-4o"
ENDPOINT = "https://api.openai.com/v1/chat/completions"
SYSTEM_PROMPT = "你的系统提示词"
```

## 优势

1. **更好的性能**: Worker 启动更快，响应时间更短
2. **更灵活的路由**: 可以自定义复杂的路由逻辑
3. **统一部署**: 静态资产和 API 统一部署，无需分离
4. **更好的错误处理**: 统一的错误处理和 CORS 支持

## 注意事项

1. 确保环境变量正确配置
2. 静态资产通过 Worker 服务，可能影响缓存策略
3. 开发时使用 `npm run dev` 进行本地测试

## 迁移验证

部署后验证以下功能：
- [ ] 主页面能正常加载
- [ ] 静态资产（CSS、JS、图片）能正常加载
- [ ] API 接口 `/api/divination` 能正常响应
- [ ] SSE 流式响应正常工作
- [ ] AI 设置面板功能正常 