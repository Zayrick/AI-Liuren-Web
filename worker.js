/**
 * @file worker.js
 * @brief Cloudflare Worker 入口。
 * @details 该 Worker 仅处理 `/api/divination` POST/SSE 请求，其余请求返回 404。
 *          业务逻辑完全复用原 Cloudflare Pages Function `functions/divination.js`，
 *          避免重复实现。
 *
 *          ⚠️ 静态资源若需一并迁移，请使用 `[site]` 配置或 R2 结合 Workers
 *          进行托管，当前示例聚焦 API 迁移。
 *
 * @author AI
 * @date 2025-06-16
 */

// -------------------- 依赖导入 --------------------
import { onRequestPost as handleDivinationPost } from "./functions/divination.js";

/**
 * @brief Worker fetch 事件处理器。
 * @param {Request}                    request - HTTP 请求对象。
 * @param {Record<string,string>}      env     - 绑定的环境变量。
 * @param {import("@cloudflare/workers-types").ExecutionContext} ctx - 执行上下文。
 * @return {Promise<Response>} HTTP 响应。
 */
async function fetchHandler(request, env, ctx) {
  const url = new URL(request.url);

  // 仅处理占卜接口
  if (url.pathname === "/api/divination" && request.method === "POST") {
    return handleDivinationPost({ request, env });
  }

  // 其它路径统一返回 404，或按需自定义静态资源逻辑
  return new Response("Not Found", { status: 404 });
}

/**
 * @brief Worker 模块导出。
 */
export default {
  fetch: fetchHandler
}; 