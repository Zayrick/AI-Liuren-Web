/**
 * @file ganzhi.js
 * @brief 基于「lunar-javascript」封装的四柱八字工具。
 *        仅保留最小封装，完全依赖第三方库，摆脱自研历法算法，
 *        以获得更可靠、长期维护的能力。
 * @details 该文件替换了原先上千行的干支/农历计算逻辑，
 *          现在仅作为对外 API 包装层存在，方便保持调用方代码不变。
 *          如果后续需要更多农历功能，可直接查阅官方文档：
 *          https://6tail.cn/calendar/api.html
 *
 * @author AI
 * @date 2025-08-02
 */

import { Solar } from "lunar-javascript";

// 将任意 Date 对象转换为东八区（UTC+8）时间，保证在 Cloudflare（默认 UTC）环境下也能得到一致结果。
function convertToBeijing(date) {
  // 目标时区相对于 UTC 的偏移，单位分钟。北京/上海为 -480。
  const TARGET_OFFSET = -480;
  // 当前运行环境的本地时区偏移，单位分钟。
  const localOffset = date.getTimezoneOffset();
  // 需要调整的分钟差 = 本地偏移 - 目标偏移。
  const diffMinutes = localOffset - TARGET_OFFSET;
  return new Date(date.getTime() + diffMinutes * 60 * 1000);
}

/**
 * 计算并格式化完整的四柱八字。
 *
 * @param {Date} [date=new Date()] JS Date 对象，可传入任意时间点。
 * @return {string} 示例："甲子年 丙寅月 戊申日 壬子时"。
 */
export function getFullBazi(date = new Date()) {
  // 统一转换为东八区时间后再进行干支计算。
  const bjDate = convertToBeijing(date);

  // 直接使用最新 lunar-javascript 提供的 Solar.fromDate API。
  const solar = Solar.fromDate(bjDate);

  const lunar = solar.getLunar();
  const year = lunar.getYearInGanZhi();
  const month = lunar.getMonthInGanZhi();
  const day = lunar.getDayInGanZhi();
  const hour = lunar.getTimeInGanZhi();

  return `${year}年 ${month}月 ${day}日 ${hour}时`;
}
