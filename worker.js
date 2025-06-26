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
// 卦象计算已迁移到前端，不再需要这些导入
// import { generateHexagram } from "./lib/hexagram.js";
// import { resolveClientTime } from "./lib/time.js";
// import { getFullBazi } from "./lib/ganzhi.js";

/**
 * @typedef {Object} StreamDivinationParams
 * @property {number[]} numbers            - 三个数字
 * @property {string}   question           - 占卜问题
 * @property {boolean}  showReasoning      - 是否推送 AI 推理过程
 * @property {string}   apiKey             - AI API Key
 * @property {string}   model              - 模型名称
 * @property {string}   endpoint           - API 端点
 * @property {string}   hexagram           - 前端计算的卦象
 * @property {string}   fullBazi           - 前端计算的完整八字
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

async function generateTitle({ question, usedApiKey, usedEndpoint, titleModel, writer, encoder }) {
  try {
    const messages = [
      {
        role: "user",
        content: `用简单几个字总结用户占卜的问题，总结占卜标题，显示在软件页面
你只要输出标题，不包含任何其他内容，以及句号，内容为占问: XXX 
用户占卜的问题是：${question}`
      }
    ];

    const requestBody = {
      model: titleModel,
      messages,
      max_tokens: 50, 
      stream: true
    };

    const aiResp = await fetch(usedEndpoint, {
      method: "POST",
      headers: buildSafeHeaders({
        Authorization: `Bearer ${usedApiKey}`,
        "Content-Type": "application/json"
      }),
      body: JSON.stringify(requestBody)
    });

    if (!aiResp.ok || !aiResp.body) {
      console.error(`Title generation failed: ${await aiResp.text()}`);
      return;
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
        if (delta.content) {
          await writer.write(encoder.encode(`event: title\ndata: ${delta.content.replace(/\n/g, "\\n")}\n\n`));
        }
      }
    }
  } catch (err) {
    console.error("Error during title generation:", err);
  }
}

/**
 * @brief SSE 流式推送小六壬解卦结果
 * @param {StreamDivinationParams} params - 业务参数
 * @param {Record<string,string>}   env    - Cloudflare 环境变量
 * @return {Promise<Response>} SSE Response
 */
async function streamDivination({ numbers, question, showReasoning, apiKey, model, endpoint, openrouterSort, hexagram, fullBazi, currentDateTime }, env) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      // 优先使用用户提供的值，否则回退到环境变量
      const usedApiKey = (apiKey && apiKey.trim()) || env.API_KEY;
      const usedModel =
        (model && model.trim()) ||
        (showReasoning && env.REASONING_MODEL
          ? env.REASONING_MODEL
          : env.MODEL);
      const usedEndpoint = (endpoint && endpoint.trim()) || env.ENDPOINT;
      const titleModel = (model && model.trim()) || env.TITLE_MODEL;

      // API Key 是必须的，无论是用户提供还是环境变量配置
      if (!usedApiKey) {
        throw new Error("API Key 未配置，无法处理请求。请在前端设置或在后端环境变量中提供。");
      }

      await writer.write(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({ question, hexagram, time: fullBazi })}\n\n`
        )
      );

      const mainDivinationTask = (async () => {
        const messages = [];
        if (env.SYSTEM_PROMPT) {
          messages.push({ role: "system", content: env.SYSTEM_PROMPT });
        }
        let userContent = `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}`;
        if (currentDateTime) {
          userContent += `\n${currentDateTime}`;
        }
        messages.push({ role: "user", content: userContent });

        const requestBody = {
          model: usedModel,
          messages,
          max_tokens: 4096,
          reasoning: showReasoning ? { max_tokens: 2048 } : undefined,
          stream: true
        };

        // 使用用户传递的openrouterSort或环境变量中的值
        const sortOption = openrouterSort || env.OPENROUTER_SORT;
        if (usedEndpoint.includes('openrouter') && sortOption) {
          requestBody.provider = {
            sort: sortOption
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
      })();

      const titleGenerationTask = generateTitle({
        question,
        usedApiKey,
        usedEndpoint,
        titleModel,
        writer,
        encoder
      });
      
      await Promise.all([mainDivinationTask, titleGenerationTask]);

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
    
    const { numbers, question, show_reasoning = true, apiKey, model, endpoint, openrouterSort, hexagram, fullBazi, currentDateTime } = body || {};
    if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
      return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
    }
    
    // 新增：服务器端输入校验
    if ((model || endpoint) && !apiKey) {
      return new Response("如指定模型或 API 地址，则必须填写 API Key。", { 
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    
    // 验证OpenRouter特定要求
    if (endpoint && endpoint.toLowerCase().includes('openrouter') && openrouterSort && !apiKey) {
      return new Response("使用 OpenRouter 排序功能必须配置 API Key。", { 
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    
    return streamDivination({ 
      numbers, 
      question, 
      showReasoning: show_reasoning, 
      apiKey, 
      model, 
      endpoint, 
      openrouterSort,
      hexagram, 
      fullBazi,
      currentDateTime 
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
