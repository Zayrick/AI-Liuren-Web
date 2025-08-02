/**
 * Cloudflare Worker：小六壬占卜 + AI 解卦（精简版）
 * 
 * 主要职责：
 * 1. 静态资源服务
 * 2. API 路由与占卜业务
 * 3. AI 流式 SSE 推送
 */

import { generateHexagram } from "./lib/hexagram.js";
import { getFullBazi } from "./lib/ganzhi.js";

// ********************************************************
// *                      工具函数                        *
// ********************************************************

/** 根据文件扩展名返回 MIME */
const MIME_TYPES = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8"
};

/** 构造仅包含白名单字段的 Headers */
// 构造仅包含白名单字段的 Headers，其中包含调用 AI 服务所需的自定义字段
const buildSafeHeaders = init => {
  const safe = new Headers();
  // 允许的 Header 白名单
  const whitelist = [
    "authorization",
    "content-type",
    "http-referer", // 供统计来源使用
    "x-title" // 标识调用来源
  ];
  for (const [k, v] of new Headers(init)) {
    if (whitelist.includes(k.toLowerCase())) safe.append(k, v);
  }
  return safe;
};

/** 迭代 AI SSE 流中的 data 行 */
async function* iterateSSELines(bodyStream) {
  const reader = bodyStream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.startsWith("data: ")) yield line.slice(6);
    }
  }
}

const encoder = new TextEncoder();

// ********************************************************
// *                        AI                            *
// ********************************************************

/** 标题生成 */
async function generateTitle({ question, apiKey, endpoint, model, writer }) {
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: buildSafeHeaders({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://xl.oxiz.xyz",
      "X-Title": "OraCloud"
    }),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: `用简单几个字总结用户占卜的问题，总结占卜标题，显示在软件页面\n你只要输出标题，不包含任何其他内容，以及句号，内容为占问: XXX \n用户占卜的问题是：${question}`
        }
      ],
      max_tokens: 50,
      stream: true
    })
  });

  if (!resp.ok || !resp.body) {
    console.error("Title generation failed:", await resp.text());
    return;
  }

  for await (const line of iterateSSELines(resp.body)) {
    if (line === "[DONE]") continue;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    const text = payload.choices?.[0]?.delta?.content;
    if (text) {
      await writer.write(
        encoder.encode(`event: title\ndata: ${text.replace(/\n/g, "\\n")}\n\n`)
      );
    }
  }
}

// ********************************************************
// *                    占卜核心逻辑                      *
// ********************************************************

async function streamDivination(params, env) {
  const {
    numbers,
    question,
    showReasoning,
    apiKey,
    model,
    titleModel,
    reasoningModel,
    endpoint,
    openrouterSort,
    hexagram,
    fullBazi,
    currentDateTime
  } = params;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      // ---------- 参数整理 ----------
      const usedApiKey = apiKey?.trim() || env.API_KEY;
      if (!usedApiKey) throw new Error("API Key 未配置");

      const usedEndpoint = endpoint?.trim() || env.ENDPOINT;
      const usedModel = model?.trim() || env.MODEL;
      const usedTitleModel = titleModel?.trim() || env.TITLE_MODEL || usedModel;
      const usedReasoningModel = showReasoning
        ? reasoningModel?.trim() || env.REASONING_MODEL || usedModel
        : usedModel;

      const h = hexagram || generateHexagram(numbers);
      const bz = fullBazi || getFullBazi(new Date());
      const dt = currentDateTime || new Date().toLocaleString("zh-CN", { hour12: false });

      await writer.write(
        encoder.encode(`event: meta\ndata: ${JSON.stringify({ question, hexagram: h, time: bz })}\n\n`)
      );

      // ---------- AI 主逻辑 ----------
      const messages = [];
      if (env.SYSTEM_PROMPT) messages.push({ role: "system", content: env.SYSTEM_PROMPT });
      messages.push({
        role: "user",
        content: `所问之事：${question}\n所得之卦：${h}\n所占之时：${bz}${dt ? `\n${dt}` : ""}`
      });

      const body = {
        model: showReasoning ? usedReasoningModel : usedModel,
        messages,
        max_tokens: 4096,
        stream: true
      };
      if (usedEndpoint.includes("openrouter") && openrouterSort) {
        body.provider = { sort: openrouterSort };
      }

      const aiResp = await fetch(usedEndpoint, {
        method: "POST",
        headers: buildSafeHeaders({
          Authorization: `Bearer ${usedApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://xl.oxiz.xyz",
          "X-Title": "OraCloud"
        }),
        body: JSON.stringify(body)
      });

      if (!aiResp.ok || !aiResp.body) {
        throw new Error(`AI 响应错误：${await aiResp.text()}`);
      }

      for await (const line of iterateSSELines(aiResp.body)) {
        if (line === "[DONE]") continue;
        let payload;
        try {
          payload = JSON.parse(line);
        } catch {
          continue;
        }
        const delta = payload.choices?.[0]?.delta || {};
        if (delta.reasoning) {
          await writer.write(
            encoder.encode(
              `event: reasoning\ndata: ${delta.reasoning.replace(/\n/g, "\\n")}\n\n`
            )
          );
        }
        if (delta.content) {
          await writer.write(
            encoder.encode(`event: answer\ndata: ${delta.content.replace(/\n/g, "\\n")}\n\n`)
          );
        }
      }

      // ---------- 生成标题 ----------
      await generateTitle({
        question,
        apiKey: usedApiKey,
        endpoint: usedEndpoint,
        model: usedTitleModel,
        writer
      });
    } catch (err) {
      await writer.write(
        encoder.encode(`event: error\ndata: ${String(err).replace(/\n/g, " ")}\n\n`)
      );
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

// ********************************************************
// *                     API 路由处理                     *
// ********************************************************

async function handleDivinationAPI(request, env) {
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

  // 仅处理 SSE
  if (request.headers.get("Accept") === "text/event-stream") {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("请求体需为 JSON", { status: 400 });
    }

    const { numbers, question } = body || {};
    if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
      return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
    }

    const {
      model,
      titleModel,
      reasoningModel,
      endpoint,
      apiKey,
      show_reasoning = true,
      openrouterSort,
      hexagram,
      fullBazi,
      currentDateTime
    } = body;

    if ((model || titleModel || reasoningModel || endpoint) && !apiKey) {
      return new Response("如指定模型或 API 地址，则必须填写 API Key。", { status: 400 });
    }
    if (endpoint?.toLowerCase().includes("openrouter") && openrouterSort && !apiKey) {
      return new Response("使用 OpenRouter 排序功能必须配置 API Key。", { status: 400 });
    }

    return streamDivination(
      {
        numbers,
        question,
        showReasoning: show_reasoning,
        apiKey,
        model,
        titleModel,
        reasoningModel,
        endpoint,
        openrouterSort,
        hexagram,
        fullBazi,
        currentDateTime
      },
      env
    );
  }

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

// ********************************************************
// *                     Worker 入口                      *
// ********************************************************

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API
    if (url.pathname === "/api/divination") {
      return handleDivinationAPI(request, env);
    }

    // 静态资源
    try {
      const assetPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const asset = await env.ASSETS.fetch(new Request(`${url.origin}/${assetPath}`));
      if (asset.status === 200) {
        return new Response(asset.body, {
          status: asset.status,
          headers: {
            ...asset.headers,
            "Content-Type": MIME_TYPES[assetPath.split(".").pop()] || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    } catch (err) {
      console.error("静态资产服务错误:", err);
    }

    // 404
    return new Response("页面未找到", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
