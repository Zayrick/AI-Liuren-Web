/**
 * @file divination.js
 * @brief Cloudflare Pages Function：六爻占卜 + AI 解卦接口。
 *        前端向此端点发送 POST 请求，携带 `numbers`、`question`、`show_reasoning` 字段。
 *        本函数完成干支与卦象推算，并调用 OpenRouter AI 返回解卦结果。
 *
 * @author AI
 * @date 2025-06-11
 */

// **************************** 常量定义 ****************************
/** 天干数组 */
const GAN = [
  "甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"
];
/** 地支数组 */
const ZHI = [
  "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"
];
/** 日柱计算基准日（1900-01-01 00:00:00 UTC） */
const DAY_BASE = new Date("1900-01-01T00:00:00Z");

// **************************** 辅助函数 ****************************
/**
 * @brief 计算指定日期距 1900-01-01（本地时区 00:00:00）的天数差。
 *        与 liuyao_divination.py 的 `(date.date() - DAY_BASE.date()).days` 保持一致，
 *        只使用日期部分，完全忽略时分秒及时区偏移。
 * @param {Date} date - JS Date 对象。
 * @return {number} 天数差（可为 0 或正整数）。
 */
function diffDaysSinceBase(date) {
  // 取本地时区的"当日零点"时间戳
  const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // 取 1900-01-01 本地时区零点的时间戳
  const baseMidnight = new Date(1900, 0, 1);
  return Math.floor((localMidnight.getTime() - baseMidnight.getTime()) / 86_400_000);
}

/**
 * @brief 计算指定日期的日柱干支（严格遵循 liuyao_divination.py）。
 * @param {Date} date - JS Date 对象。
 * @return {string} 日柱干支（如 "甲子"）。
 */
function getDayGanzhi(date) {
  const diffDays = diffDaysSinceBase(date);
  const ganIndex = diffDays % 10;
  // 1900-01-01 为甲戌，因此需额外偏移 10 以获得正确地支序号
  const zhiIndex = (diffDays + 10) % 12;
  return GAN[ganIndex] + ZHI[zhiIndex];
}

/**
 * @brief 计算指定日期的时柱干支（严格遵循 liuyao_divination.py）。
 * @param {Date} date - JS Date 对象。
 * @return {string} 时柱干支（如 "甲子"）。
 */
function getHourGanzhi(date) {
  const hour = date.getHours();
  // 地支索引：每 2 小时对应一个地支，23 点特殊归属子时（0）
  let zhiIndex = Math.floor(hour / 2);
  if (hour === 23) zhiIndex = 0;

  // 计算当前日的天干序号
  const dayGanIndex = diffDaysSinceBase(date) % 10;
  // 对应 Python `hour_gan_base` 表
  const hourGanBase = [0, 2, 4, 6, 8];
  const hourGanIndex = (hourGanBase[dayGanIndex % 5] + zhiIndex) % 10;

  return GAN[hourGanIndex] + ZHI[zhiIndex];
}

/**
 * @brief 计算指定日期的年柱干支（简化，未考虑立春）。
 * @param {Date} date - JS Date 对象。
 * @return {string} 年柱干支。
 */
function getYearGanzhi(date) {
  const offset = date.getFullYear() - 1984; // 1984 为甲子年
  const ganIndex = offset % 10;
  const zhiIndex = offset % 12;
  return GAN[ganIndex] + ZHI[zhiIndex];
}

/**
 * @brief 计算指定日期的月柱干支（简化，未按节气）。
 * @param {Date} date - JS Date 对象。
 * @return {string} 月柱干支。
 */
function getMonthGanzhi(date) {
  const yearGanIndex = (date.getFullYear() - 1984) % 10;
  const month = date.getMonth() + 1; // JS month: 0-11 → 1-12
  // 地支索引
  let zhiIndex = (month + 1) % 12;
  if (zhiIndex === 0) zhiIndex = 12;
  zhiIndex -= 3;
  if (zhiIndex <= 0) zhiIndex += 12;
  // 天干索引
  const baseGan = [2, 4, 6, 8, 0];
  const ganIndex = (baseGan[yearGanIndex % 5] + (month - 1)) % 10;
  return GAN[ganIndex] + ZHI[zhiIndex];
}

/**
 * @brief 根据三个数字生成卦象。
 * @param {number[]} numbers - 长度为 3 的数字数组。
 * @return {string} 卦象词语组合（如 "大安 小吉 空亡"）。
 */
function generateHexagram(numbers) {
  const words = ["大安", "留连", "速喜", "赤口", "小吉", "空亡"];
  // 第一爻
  let firstIndex = numbers[0] % 6 || 6;
  // 第二爻
  let secondIndex = (numbers[0] + numbers[1] - 1) % 6 || 6;
  // 第三爻
  let thirdIndex = (numbers[0] + numbers[1] + numbers[2] - 2) % 6 || 6;
  return `${words[firstIndex - 1]} ${words[secondIndex - 1]} ${words[thirdIndex - 1]}`;
}

// **************************** 主处理逻辑 ****************************
/**
 * @brief 以 Server-Sent Events (text/event-stream) 的形式实时推送 AI 推理与解答。
 *
 * @param {Object}   params                 – 参数表。
 * @param {number[]} params.numbers         – 三个数字。
 * @param {string}   params.question        – 用户问题。
 * @param {boolean}  params.showReasoning   – 是否推送推理过程。
 * @param {Record<string,string>} env       – 环境变量集合。
 * @return {Promise<Response>} 返回可持续推送的 SSE Response。
 */
async function streamDivination({ numbers, question, showReasoning }, env) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 在后台异步执行全部推流逻辑，避免阻塞 Response 返回
  (async () => {
    try {
      // ---------- 1. 计算卦象 & 八字 ----------
      const now = new Date();
      const fullBazi = `${getYearGanzhi(now)}年 ${getMonthGanzhi(now)}月 ${getDayGanzhi(now)}日 ${getHourGanzhi(now)}时`;
      const hexagram = generateHexagram(numbers);

      // ---------- 2. 推送 meta 事件 ----------
      await writer.write(encoder.encode(`event: meta\ndata: ${JSON.stringify({ hexagram, time: fullBazi })}\n\n`));

      // ---------- 3. 调用 OpenRouter (SSE) ----------
      const messages = [];
      if (env.SYSTEM_PROMPT) {
        messages.push({ role: "system", content: env.SYSTEM_PROMPT });
      }
      messages.push({ role: "user", content: `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}` });

      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error("未配置 OPENROUTER_API_KEY");

      const aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "anthropic/claude-opus-4",
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

  // 立即返回可读流，让浏览器尽快建立连接
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}

/**
 * @brief Cloudflare Pages onRequest POST 入口。
 * @param {Object} ctx - 请求上下文，含 request 与 env。
 * @param {Request} ctx.request - HTTP 请求对象。
 * @param {Record<string,string>} ctx.env - 绑定的环境变量。
 * @return {Promise<Response>} 应答。
 */
/**
 * @note 本函数包含较多 console.log，用于 Cloudflare Pages Functions 调试日志输出。
 */
export async function onRequestPost({ request, env }) {
  // 若前端希望 SSE 流式响应，应在请求头中带 Accept: text/event-stream
  if (request.headers.get("Accept") === "text/event-stream") {
    // 解析 JSON 请求体（POST）
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("请求体需为 JSON", { status: 400 });
    }
    const { numbers, question, show_reasoning = true } = body || {};
    if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
      return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
    }
    // 走流式分支
    return streamDivination({ numbers, question, showReasoning: show_reasoning }, env);
  }

  console.log(`[divination] ⏱ 请求开始: ${new Date().toISOString()}`);
  // ---------- 1. 解析请求体 ----------
  let body;
  try {
    body = await request.json();
    console.log(`[divination] 📥 请求体: ${JSON.stringify(body)}`);
  } catch (e) {
    console.error(`[divination] ❌ JSON 解析失败: ${e}`);
    return new Response("请求体应为 JSON", { status: 400 });
  }

  const { numbers, question, show_reasoning = true } = body || {};
  if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
    console.warn(`[divination] ⚠️ 参数不合法: numbers=${JSON.stringify(numbers)}, question=${question}`);
    return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
  }

  // ---------- 2. 计算干支与卦象 ----------
  const now = new Date();
  const fullBazi = `${getYearGanzhi(now)}年 ${getMonthGanzhi(now)}月 ${getDayGanzhi(now)}日 ${getHourGanzhi(now)}时`;
  const hexagram = generateHexagram(numbers);
  console.log(`[divination] 🔢 生成卦象: ${hexagram}, 时辰: ${fullBazi}`);

  // ---------- 3. 构造 AI 消息 ----------
  const systemPrompt = env.SYSTEM_PROMPT || "";
  /** @type {{role:string, content:string}[]} */
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({
    role: "user",
    content: `所问之事：${question}\n所得之卦：${hexagram}\n所占之时：${fullBazi}`
  });
  console.log(`[divination] 📨 发送至 AI 的消息: ${JSON.stringify(messages)}`);

  // ---------- 4. 调用 OpenRouter AI ----------
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("[divination] ❌ 未配置 OPENROUTER_API_KEY");
    return new Response("未配置 OPENROUTER_API_KEY", { status: 500 });
  }

  let aiResp;
  try {
    aiResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "anthropic/claude-opus-4",
        messages,
        max_tokens: 4096,
        reasoning: show_reasoning ? { max_tokens: 2048 } : undefined,
        stream: false
      })
    });
  } catch (e) {
    console.error(`[divination] ❌ fetch 失败: ${e}`);
    return new Response("AI 请求失败", { status: 502 });
  }

  console.log(`[divination] 🏷 AI 响应状态: ${aiResp.status}`);
  if (!aiResp.ok) {
    const errText = await aiResp.text();
    console.error(`[divination] ❌ AI 响应非 200: ${errText}`);
    return new Response(`AI 请求失败：${aiResp.statusText}`, { status: 502 });
  }

  const aiData = await aiResp.json();
  console.log(`[divination] 📤 AI 响应 JSON: ${JSON.stringify(aiData)}`);
  const choice = aiData.choices?.[0];
  const answerContent = choice?.message?.content ?? "";
  const reasoningContent = choice?.message?.reasoning ?? "";

  // ---------- 5. 返回结果 ----------
  const result = {
    question,
    hexagram,
    time: fullBazi,
    reasoning: reasoningContent,
    answer: answerContent
  };
  console.log(`[divination] ✅ 处理完成，返回结果: ${JSON.stringify(result)}`);
  console.log(`[divination] ⏹ 请求结束: ${new Date().toISOString()}`);

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
} 