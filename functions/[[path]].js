/**
 * @file [[path]].js
 * @brief Cloudflare Pages Function：通用路径代理（AI/OpenAPI 专用）。
 * @details 访问 https://<绑定域名>/<target-host>/<target-path> 时，
 *          将请求不加修改地转发至 https://<target-host>/<target-path>。
 *
 *          典型用例：
 *          https://your-domain.pages.dev/api.openai.com/v1/completions
 *          -> 转发至 https://api.openai.com/v1/completions
 *
 *          ✅ 自动携带原请求 Method / Headers / Body
 *          ✅ 完整支持流式响应（SSE / chunked）
 *          ✅ CORS 支持（Access-Control-Allow-Origin:* 等）
 *
 * @author AI
 * @date 2025-06-16
 */

// -------------------- CORS 统一响应头 --------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400"
};

/**
 * @brief 处理 OPTIONS 预检请求。
 * @return {Response}
 */
export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * @brief 通用请求处理（捕获所有 Method）。
 * @param {import("@cloudflare/workers-types").EventContext} ctx - 请求上下文。
 * @return {Promise<Response>} - 转发后的响应。
 */
export async function onRequest(ctx) {
  const { request } = ctx;
  const url = new URL(request.url);
  const rawPath = url.pathname.slice(1); // 去掉前导 '/'

  // 若路径为空，则返回简单欢迎页
  if (!rawPath) {
    return new Response("AI API Proxy is running.", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...CORS_HEADERS
      }
    });
  }

  // === 组装目标 URL ===
  // 保留查询字符串，默认使用 https 协议
  const targetUrl = `https://${rawPath}${url.search}`;

  // 克隆请求头并移除可能引发错误的头
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  // === 发起转发请求 ===
  let fetchResp;
  try {
    fetchResp = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
      redirect: "follow"
    });
  } catch (err) {
    return new Response(`上游请求失败：${err}`, { status: 502, headers: CORS_HEADERS });
  }

  // === 构造返回 ===
  const respHeaders = new Headers(fetchResp.headers);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => respHeaders.set(k, v));

  return new Response(fetchResp.body, {
    status: fetchResp.status,
    statusText: fetchResp.statusText,
    headers: respHeaders
  });
} 