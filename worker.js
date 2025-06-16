/**
 * @file worker.js
 * @brief Cloudflare Worker 入口。
 * @details 该 Worker 处理 `/api/divination` POST/SSE 请求，同时托管静态资源。
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
 * @brief 获取静态文件内容
 * @param {string} path - 文件路径
 * @return {Promise<Response|null>} 文件响应或 null
 */
async function getStaticFile(path) {
  // 静态文件映射（这里需要手动列出所有需要的文件）
  const staticFiles = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/manifest.json': 'manifest.json',
    '/web-manifest-combined.json': 'web-manifest-combined.json',
    '/service-worker.js': 'service-worker.js',
    '/icon.png': 'icon.png'
  };

  const filePath = staticFiles[path];
  if (!filePath) return null;

  try {
    // 动态导入文件内容（需要将静态文件转换为 JS 模块）
    const fileModule = await import(`./${filePath}.js`);
    const content = fileModule.default;
    
    // 根据文件类型设置 Content-Type
    let contentType = 'text/plain';
    if (filePath.endsWith('.html')) contentType = 'text/html; charset=utf-8';
    else if (filePath.endsWith('.json')) contentType = 'application/json; charset=utf-8';
    else if (filePath.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
    else if (filePath.endsWith('.png')) contentType = 'image/png';

    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    return null;
  }
}

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
  const staticResponse = await getStaticFile(url.pathname);
  if (staticResponse) {
    return staticResponse;
  }

  // 处理 assets 目录下的文件
  if (url.pathname.startsWith('/assets/')) {
    // 尝试返回一个简单的 CSS 或 JS 内容
    if (url.pathname === '/assets/css/style.css') {
      return new Response('/* CSS content would go here */', {
        headers: { 'Content-Type': 'text/css' }
      });
    }
    if (url.pathname === '/assets/js/app.js') {
      return new Response('// JS content would go here', {
        headers: { 'Content-Type': 'application/javascript' }
      });
    }
  }

  // 其它路径返回 404
  return new Response("Not Found", { status: 404 });
}

/**
 * @brief Worker 模块导出。
 */
export default {
  fetch: fetchHandler
}; 