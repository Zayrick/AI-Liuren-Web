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

/**
 * 计算并格式化完整的四柱八字。
 *
 * @param {Date} [date=new Date()] JS Date 对象，可传入任意时间点。
 * @return {string} 示例："甲子年 丙寅月 戊申日 壬子时"。
 */
export function getFullBazi(date = new Date()) {
  // lunar-javascript >=1.5.0 起提供 Solar.fromDate，低版本可用备用方案
  let solar;
  if (typeof Solar.fromDate === "function") {
    solar = Solar.fromDate(date);
  } else if (typeof Solar.fromYmdHms === "function") {
    solar = Solar.fromYmdHms(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    );
  } else {
    // 最低保底：只精确到日期，不含时间
    solar = Solar.fromYmd(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate()
    );
  }

  const lunar = solar.getLunar();
  const year = lunar.getYearInGanZhi();
  const month = lunar.getMonthInGanZhi();
  const day = lunar.getDayInGanZhi();
  const hour = lunar.getTimeInGanZhi();

  return `${year}年 ${month}月 ${day}日 ${hour}时`;
}
