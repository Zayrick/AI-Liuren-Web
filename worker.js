/**
 * @file worker.js
 * @brief Cloudflare Worker 入口：小六壬占卜 + AI 解卦 Web 应用
 * @details 本文件作为 Cloudflare Worker 的主要入口点，负责：
 *          1. 静态资产服务（HTML、CSS、JS等）
 *          2. API 路由处理（占卜接口）
 *          3. 请求分发与处理
 *
 * @author AI
 * @date 2025-01-12
 */

// -------------------- 依赖导入 --------------------
import { generateHexagram } from "./lib/hexagram.js";
import { resolveClientTime } from "./lib/time.js";
import {
  getYearGanzhi,
  getMonthGanzhi,
  getDayGanzhi,
  getHourGanzhi
} from "./lib/ganzhi.js";

/**
 * @typedef {Object} StreamDivinationParams
 * @property {number[]} numbers            - 三个数字
 * @property {string}   question           - 占卜问题
 * @property {boolean}  showReasoning      - 是否推送 AI 推理过程
 * @property {string}   apiKey             - AI API Key
 * @property {string}   model              - 模型名称
 * @property {string}   endpoint           - API 端点
 * @property {import("./lib/time.js").ClientTime=} clientTime - 客户端时间信息
 */

// ********************************************************
// *                    核心业务函数                      *
// ********************************************************

/**
 * @brief 构造仅包含白名单字段的安全 Headers
 * @details 只允许 Authorization、Content-Type 两个字段，过滤 cf-*、x-forwarded-for、true-client-ip 等可能暴露访客隐私的请求头。
 * @param {HeadersInit} init - 初始 Header 集合
 * @return {Headers} 过滤后的 Headers
 */
function buildSafeHeaders(init = {}) {
  const whitelist = new Set(["authorization", "content-type"]);
  const source = new Headers(init);
  const safe = new Headers();
  for (const [key, value] of source) {
    if (whitelist.has(key.toLowerCase())) {
      safe.append(key, value);
    }
  }
  return safe;
}

/**
 * @brief SSE 流式推送小六壬解卦结果
 * @param {StreamDivinationParams} params - 业务参数
 * @param {Record<string,string>}   env    - Cloudflare 环境变量
 * @return {Promise<Response>} SSE Response
 */
async function streamDivination({ numbers, question, showReasoning, apiKey, model, endpoint, clientTime }, env) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 在后台执行，尽快返回可读流供浏览器建立连接
  (async () => {
    try {
      // === 统一判定前端是否覆写 AI 连接信息 ===
      const overrideProvided = (apiKey && apiKey.trim()) || (model && model.trim()) || (endpoint && endpoint.trim());
      const usedApiKey   = overrideProvided ? apiKey   : env.API_KEY;
      let usedModel;
      if (overrideProvided) {
        usedModel = model;
      } else {
        /**
         * 当用户未设置 API，而前端请求要求展示推理过程时，
         * 默认切换至后台配置的 REASONING_MODEL（若存在），否则回退至 MODEL。
         */
        usedModel = showReasoning && env.REASONING_MODEL ? env.REASONING_MODEL : env.MODEL;
      }
      const usedEndpoint = overrideProvided ? endpoint : env.ENDPOINT;

      if (overrideProvided && (!usedApiKey || !usedModel || !usedEndpoint)) {
        throw new Error("当自定义 AI 配置时，需同时提供 apiKey、model、endpoint");
      }

      // ---------- 1️⃣ 计算卦象 & 八字 ----------
      const now = resolveClientTime(clientTime);
      const fullBazi = `${getYearGanzhi(now)}年 ${getMonthGanzhi(now)}月 ${getDayGanzhi(now)}日 ${getHourGanzhi(now)}时`;
      const hexagram = generateHexagram(numbers);

      // ---------- 2️⃣ meta 事件 ----------
      await writer.write(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({ question, hexagram, time: fullBazi })}\n\n`
        )
      );

      // ---------- 3️⃣ 组装 AI 请求 ----------
      const messages = [];
      if (env.SYSTEM_PROMPT) {
        messages.push({ role: "system", content: env.SYSTEM_PROMPT });
      }
      messages.push({ role: "user", content: `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}` });

      // ---------- 4️⃣ 调用 AI API (SSE) ----------
      
      // 1. 构建基础 body
      const requestBody = {
        model: usedModel,
        messages,
        max_tokens: 4096,
        reasoning: showReasoning ? { max_tokens: 2048 } : undefined,
        stream: true
      };

      // 2. 如果使用 OpenRouter，则动态添加 provider 字段以优化速度
      if (usedEndpoint.includes('openrouter')) {
        requestBody.provider = {
          sort: 'throughput'
        };
      }

      const aiResp = await fetch(usedEndpoint, {
        method: "POST",
        headers: buildSafeHeaders({
          Authorization: `Bearer ${usedApiKey}`,
          "Content-Type": "application/json"
        }),
        body: JSON.stringify(requestBody)
      });

      if (!aiResp.ok || !aiResp.body) {
        const errText = await aiResp.text();
        throw new Error(`AI 响应错误：${errText}`);
      }

      const reader = aiResp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const rawLine = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!rawLine.startsWith("data: ")) continue;

          const dataStr = rawLine.slice(6);
          if (dataStr === "[DONE]") continue;

          let payload;
          try { payload = JSON.parse(dataStr); } catch { continue; }
          const delta = payload.choices?.[0]?.delta || {};
          if (delta.reasoning) {
            await writer.write(encoder.encode(`event: reasoning\ndata: ${delta.reasoning.replace(/\n/g, "\\n")}\n\n`));
          }
          if (delta.content) {
            await writer.write(encoder.encode(`event: answer\ndata: ${delta.content.replace(/\n/g, "\\n")}\n\n`));
          }
        }
      }
    } catch (err) {
      await writer.write(encoder.encode(`event: error\ndata: ${String(err).replace(/\n/g, " ")}\n\n`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept"
    }
  });
}

/**
 * @brief 处理占卜API请求
 * @param {Request} request - HTTP 请求对象
 * @param {Record<string,string>} env - 环境变量
 * @return {Promise<Response>} HTTP 响应
 */
async function handleDivinationAPI(request, env) {
  // 处理 CORS 预检请求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // SSE 分支：前端需在 Header 加 Accept: text/event-stream
  if (request.headers.get("Accept") === "text/event-stream") {
    let body;
    try { 
      body = await request.json(); 
    } catch { 
      return new Response("请求体需为 JSON", { status: 400 }); 
    }
    
    const { numbers, question, show_reasoning = true, apiKey, model, endpoint, clientTime } = body || {};
    if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
      return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
    }
    
    return streamDivination({ 
      numbers, 
      question, 
      showReasoning: show_reasoning, 
      apiKey, 
      model, 
      endpoint, 
      clientTime 
    }, env);
  }

  // 对于所有其他 POST 请求，返回错误，因为我们只支持 SSE
  return new Response(
    "不支持的请求类型。本接口仅接受 'Accept: text/event-stream' 的流式请求。",
    {
      status: 400,
      headers: { 
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*" 
      }
    }
  );
}

/**
 * @brief 获取静态资产的 MIME 类型
 * @param {string} path - 文件路径
 * @return {string} MIME 类型
 */
function getMimeType(path) {
  const ext = path.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    'html': 'text/html; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'txt': 'text/plain; charset=utf-8',
    'xml': 'application/xml; charset=utf-8'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// ********************************************************
// *                    Worker 主入口                     *
// ********************************************************

/**
 * @brief Cloudflare Worker 主入口函数
 * @param {Request} request - HTTP 请求对象
 * @param {Object} env - 环境变量绑定
 * @param {Object} ctx - 执行上下文
 * @return {Promise<Response>} HTTP 响应
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // API 路由处理
    if (pathname === '/api/divination') {
      return handleDivinationAPI(request, env);
    }

    // 静态资产服务
    try {
      // 处理根路径，直接映射到 index.html（避免重定向）
      let assetPath = pathname === '/' ? 'index.html' : pathname.slice(1);
      
      // 尝试获取静态资产
      const asset = await env.ASSETS.fetch(new Request(`${url.origin}/${assetPath}`));
      
      if (asset.status === 200) {
        // 克隆响应并添加适当的 headers
        const response = new Response(asset.body, {
          status: asset.status,
          statusText: asset.statusText,
          headers: {
            ...asset.headers,
            'Content-Type': getMimeType(assetPath),
            'Cache-Control': 'public, max-age=31536000',
            'Access-Control-Allow-Origin': '*'
          }
        });
        return response;
      }
    } catch (err) {
      console.error('静态资产服务错误:', err);
    }

    // 404 处理
    return new Response('页面未找到', { 
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};