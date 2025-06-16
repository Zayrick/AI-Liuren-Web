/**
 * @file divination.js
 * @brief Cloudflare Pages Function：小六壬占卜 + AI 解卦接口（重构版）。
 * @details 本文件作为 Functions 入口，仅负责参数校验、业务编排与 SSE 推流，
 *          具体干支、卦象及时间计算逻辑已拆分到 lib 目录中，降低复杂度。
 *
 *          请求示例：
 *          POST /api/divination (Accept: text/event-stream)
 *          {
 *            "numbers": [3, 5, 2],
 *            "question": "今年事业如何？",
 *            "show_reasoning": true,
 *            "apiKey": "...",
 *            "model": "gpt-4o",
 *            "endpoint": "https://openrouter.ai/v1/chat/completions",
 *            "clientTime": {"ts": 1718511692000, "tz_offset": -480}
 *          }
 *
 * @author AI
 * @date 2025-06-16
 */

// -------------------- 依赖导入 --------------------
import { generateHexagram } from "../lib/hexagram.js";
import { resolveClientTime } from "../lib/time.js";
import {
  getYearGanzhi,
  getMonthGanzhi,
  getDayGanzhi,
  getHourGanzhi
} from "../lib/ganzhi.js";

/**
 * @typedef {Object} StreamDivinationParams
 * @property {number[]} numbers            - 三个数字。
 * @property {string}   question           - 占卜问题。
 * @property {boolean}  showReasoning      - 是否推送 AI 推理过程。
 * @property {string}   apiKey             - OpenRouter API Key。
 * @property {string}   model              - 模型名称。
 * @property {string}   endpoint           - API 端点。
 * @property {import("../lib/time.js").ClientTime=} clientTime - 客户端时间信息。
 */

// ********************************************************
// *                    核心业务函数                      *
// ********************************************************

/**
 * @brief SSE 流式推送小六壬解卦结果。
 * @param {StreamDivinationParams} params - 业务参数。
 * @param {Record<string,string>}   env    - Cloudflare 环境变量。
 * @return {Promise<Response>} SSE Response。
 */
async function streamDivination({ numbers, question, showReasoning, apiKey, model, endpoint, clientTime }, env) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 在后台执行，尽快返回可读流供浏览器建立连接
  (async () => {
    try {
      // ---------- 1️⃣ 计算卦象 & 八字 ----------
      const now = resolveClientTime(clientTime);
      const fullBazi = `${getYearGanzhi(now)}年 ${getMonthGanzhi(now)}月 ${getDayGanzhi(now)}日 ${getHourGanzhi(now)}时`;
      const hexagram = generateHexagram(numbers);

      // ---------- 2️⃣ meta 事件 ----------
      await writer.write(encoder.encode(`event: meta\ndata: ${JSON.stringify({ hexagram, time: fullBazi })}\n\n`));

      // ---------- 3️⃣ 组装 AI 请求 ----------
      /** @type {{role:string, content:string}[]} */
      const messages = [];
      if (env.SYSTEM_PROMPT) {
        messages.push({ role: "system", content: env.SYSTEM_PROMPT });
      }
      messages.push({ role: "user", content: `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}` });

      // ---------- 4️⃣ 调用 OpenRouter (SSE) ----------
      const aiResp = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 4096,
          reasoning: showReasoning ? { max_tokens: 2048 } : undefined,
          stream: true
        })
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
      Connection: "keep-alive"
    }
  });
}

// ********************************************************
// *                     HTTP 入口函数                     *
// ********************************************************

/**
 * @brief Cloudflare Pages onRequest POST 入口。
 * @param {Object} ctx                 - 请求上下文。
 * @param {Request} ctx.request        - HTTP 请求对象。
 * @param {Record<string,string>} ctx.env - 绑定的环境变量。
 * @return {Promise<Response>}         - HTTP 响应。
 */
export async function onRequestPost({ request, env }) {
  // SSE 分支：前端需在 Header 加 Accept: text/event-stream
  if (request.headers.get("Accept") === "text/event-stream") {
    /** @type {any} */ let body;
    try { body = await request.json(); } catch { return new Response("请求体需为 JSON", { status: 400 }); }
    const { numbers, question, show_reasoning = true, apiKey, model, endpoint, clientTime } = body || {};
    if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
      return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
    }
    return streamDivination({ numbers, question, showReasoning: show_reasoning, apiKey, model, endpoint, clientTime }, env);
  }

  // 非 SSE：一次性 JSON 响应
  /** @type {any} */ let body;
  try { body = await request.json(); } catch { return new Response("请求体应为 JSON", { status: 400 }); }
  const { numbers, question, show_reasoning = true, apiKey, model, endpoint, clientTime } = body || {};
  if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
    return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
  }

  // 计算八字 & 卦象
  const now = resolveClientTime(clientTime);
  const fullBazi = `${getYearGanzhi(now)}年 ${getMonthGanzhi(now)}月 ${getDayGanzhi(now)}日 ${getHourGanzhi(now)}时`;
  const hexagram = generateHexagram(numbers);

  // 组装 AI 消息
  /** @type {{role:string, content:string}[]} */
  const messages = [];
  if (env.SYSTEM_PROMPT) messages.push({ role: "system", content: env.SYSTEM_PROMPT });
  messages.push({ role: "user", content: `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}` });

  // 调用 AI
  let aiResp;
  try {
    aiResp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096,
        reasoning: show_reasoning ? { max_tokens: 2048 } : undefined,
        stream: false
      })
    });
  } catch {
    return new Response("AI 请求失败", { status: 502 });
  }

  if (!aiResp.ok) {
    const errText = await aiResp.text();
    return new Response(`AI 请求失败：${errText}`, { status: 502 });
  }

  const aiData = await aiResp.json();
  const choice = aiData.choices?.[0] || {};

  const result = {
    question,
    hexagram,
    time: fullBazi,
    reasoning: choice.message?.reasoning ?? "",
    answer: choice.message?.content ?? ""
  };
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json; charset=utf-8" } });
} 