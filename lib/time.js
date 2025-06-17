/**
 * @file time.js
 * @brief 客户端本地时间解析工具。
 * @details 由于 Cloudflare Workers 运行于 UTC，需将前端上传的时间戳与时区偏移
 *          还原为用户本地时间，保证卦象推算基于真实场景。
 * @author AI
 * @date 2025-06-16
 */

/**
 * @typedef {Object} ClientTime
 * @property {number} ts         - `Date.now()` 生成的毫秒时间戳（UTC）。
 * @property {number} tz_offset  - `Date#getTimezoneOffset()`，单位分钟，含义为 `UTC – Local`。
 */

/**
 * @brief 根据客户端上传的本地时间信息生成 Date 对象。
 * @param {ClientTime=} clientTime - 客户端时间信息，可为空。
 * @return {Date} 表示用户本地时间的 Date 对象。
 */
export function resolveClientTime(clientTime) {
  if (
    clientTime &&
    typeof clientTime.ts === "number" &&
    typeof clientTime.tz_offset === "number" &&
    Number.isFinite(clientTime.ts) &&
    Number.isFinite(clientTime.tz_offset)
  ) {
    // 将 UTC 时间戳转换为用户本地时间
    return new Date(clientTime.ts + clientTime.tz_offset * 60_000);
  }
  // 若参数非法或缺失，回退到 Cloudflare Workers 的当前 UTC 时间
  return new Date();
} 