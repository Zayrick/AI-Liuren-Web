/**
 * @file worker.js
 * @brief Cloudflare Worker 入口。
 * @details 该 Worker 处理 `/api/divination` POST/SSE 请求，同时通过 [site] 配置托管静态资源。
 *          业务逻辑完全复用原 Cloudflare Pages Function `functions/divination.js`，
 *          避免重复实现。
 *
 * @author AI
 * @date 2025-06-16
 */

// -------------------- 依赖导入 --------------------
import { getAssetFromKV } from "@cloudflare/kv-asset-handler";
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

  // 处理占卜接口
  if (url.pathname === "/api/divination" && request.method === "POST") {
    return handleDivinationPost({ request, env });
  }

  // 处理静态文件
  try {
    return await getAssetFromKV(
      {
        request,
        waitUntil: ctx.waitUntil.bind(ctx)
      },
      {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: env.__STATIC_CONTENT_MANIFEST,
        cacheControl: {
          browserTTL: 3600,
          edgeTTL: 3600 * 24
        }
      }
    );
  } catch (e) {
    // 静态文件未找到，返回 404
    return new Response("Not Found", { status: 404 });
  }
}

/**
 * @brief Worker 模块导出。
 */
export default {
  fetch: fetchHandler
}; 