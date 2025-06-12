/**
 * @file divination.js
 * @brief Cloudflare Pages Function：小六壬占卜 + AI 解卦接口。
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
// **************************** 干支计算类 ****************************
/**
 * @brief 干支计算类，严格按照2.py中的算法实现
 */
class GanZhi {
  constructor(date = null) {
    /**
     * @brief 阴历数据存储（用于月干支计算中的农历年份获取）
     */
    this.gLunarMonthDay = [
      0x4ae0, 0xa570, 0x5268, 0xd260, 0xd950, 0x6aa8, 0x56a0, 0x9ad0, 0x4ae8, 0x4ae0,  // 1910
      0xa4d8, 0xa4d0, 0xd250, 0xd548, 0xb550, 0x56a0, 0x96d0, 0x95b0, 0x49b8, 0x49b0,  // 1920
      0xa4b0, 0xb258, 0x6a50, 0x6d40, 0xada8, 0x2b60, 0x9570, 0x4978, 0x4970, 0x64b0,  // 1930
      0xd4a0, 0xea50, 0x6d48, 0x5ad0, 0x2b60, 0x9370, 0x92e0, 0xc968, 0xc950, 0xd4a0,  // 1940
      0xda50, 0xb550, 0x56a0, 0xaad8, 0x25d0, 0x92d0, 0xc958, 0xa950, 0xb4a8, 0x6ca0,  // 1950
      0xb550, 0x55a8, 0x4da0, 0xa5b0, 0x52b8, 0x52b0, 0xa950, 0xe950, 0x6aa0, 0xad50,  // 1960
      0xab50, 0x4b60, 0xa570, 0xa570, 0x5260, 0xe930, 0xd950, 0x5aa8, 0x56a0, 0x96d0,  // 1970
      0x4ae8, 0x4ad0, 0xa4d0, 0xd268, 0xd250, 0xd528, 0xb540, 0xb6a0, 0x96d0, 0x95b0,  // 1980
      0x49b0, 0xa4b8, 0xa4b0, 0xb258, 0x6a50, 0x6d40, 0xada0, 0xab60, 0x9370, 0x4978,  // 1990
      0x4970, 0x64b0, 0x6a50, 0xea50, 0x6b28, 0x5ac0, 0xab60, 0x9368, 0x92e0, 0xc960,  // 2000
      0xd4a8, 0xd4a0, 0xda50, 0x5aa8, 0x56a0, 0xaad8, 0x25d0, 0x92d0, 0xc958, 0xa950,  // 2010
      0xb4a0, 0xb550, 0xb550, 0x55a8, 0x4ba0, 0xa5b0, 0x52b8, 0x52b0, 0xa930, 0x74a8,  // 2020
      0x6aa0, 0xad50, 0x4da8, 0x4b60, 0x9570, 0xa4e0, 0xd260, 0xe930, 0xd530, 0x5aa0,  // 2030
      0x6b50, 0x96d0, 0x4ae8, 0x4ad0, 0xa4d0, 0xd258, 0xd250, 0xd520, 0xdaa0, 0xb5a0,  // 2040
      0x56d0, 0x4ad8, 0x49b0, 0xa4b8, 0xa4b0, 0xaa50, 0xb528, 0x6d20, 0xada0, 0x55b0,  // 2050
    ];

    /**
     * @brief 闰月数据
     */
    this.gLunarMonth = [
      0x00, 0x50, 0x04, 0x00, 0x20,  // 1910
      0x60, 0x05, 0x00, 0x20, 0x70,  // 1920
      0x05, 0x00, 0x40, 0x02, 0x06,  // 1930
      0x00, 0x50, 0x03, 0x07, 0x00,  // 1940
      0x60, 0x04, 0x00, 0x20, 0x70,  // 1950
      0x05, 0x00, 0x30, 0x80, 0x06,  // 1960
      0x00, 0x40, 0x03, 0x07, 0x00,  // 1970
      0x50, 0x04, 0x08, 0x00, 0x60,  // 1980
      0x04, 0x0a, 0x00, 0x60, 0x05,  // 1990
      0x00, 0x30, 0x80, 0x05, 0x00,  // 2000
      0x40, 0x02, 0x07, 0x00, 0x50,  // 2010
      0x04, 0x09, 0x00, 0x60, 0x04,  // 2020
      0x00, 0x20, 0x60, 0x05, 0x00,  // 2030
      0x30, 0xb0, 0x06, 0x00, 0x50,  // 2040
      0x02, 0x07, 0x00, 0x50, 0x03  // 2050
    ];

    this.START_YEAR = 1901;

    // 节气
    this.jie = '小寒大寒立春雨水惊蛰春分清明谷雨立夏小满芒种夏至小暑大暑立秋处暑白露秋分寒露霜降立冬小雪大雪冬至';
    // 节气划分农历干支月
    this.jieQiOdd = "立春惊蛰清明立夏芒种小暑立秋白露寒露立冬大雪小寒";
    // 节气对应农历干支月
    this.jieQiMonth = {
      "立春": [0, "寅"],
      "惊蛰": [1, "卯"],
      "清明": [2, "辰"],
      "立夏": [3, "巳"],
      "芒种": [4, "午"],
      "小暑": [5, "未"],
      "立秋": [6, "申"],
      "白露": [7, "酉"],
      "寒露": [8, "戌"],
      "立冬": [9, "亥"],
      "大雪": [10, "子"],
      "小寒": [11, "丑"],
    };

    this.localtime = date || new Date();
    this.gzYearValue = "";
  }

  /**
   * @brief 计算干支纪年
   * @return {string} 干支纪年字符串，如"甲子"
   */
  gzYear() {
    const year = this.lnYear() - 3 - 1;  // 农历年份减3（补减1）
    const G = year % 10;  // 模10，得到天干数
    const Z = year % 12;  // 模12，得到地支数
    this.gzYearValue = GAN[G] + ZHI[Z];
    return this.gzYearValue;
  }

  /**
   * @brief 计算干支纪月
   * 干支纪月的计算规则：
   * 1、首先判断当前日期所处的节气范围
   * 2、特别要考虑年数是否需要增减，以立春为界
   * 3、月的天干公式：（年干序号 * 2 + 月数） % 10
   * 4、月的地支是固定的，查表可得
   * @return {string} 干支纪月字符串，如"丙寅"
   */
  gzMonth() {
    const ct = this.localtime;
    const jieQi = this.lnJie();
    const nlMonthVal = this.lnMonth();
    
    let nlYear = "";
    let nlMonth = 0;
    
    if (jieQi.length > 0 && this.jieQiOdd.includes(jieQi)) {  // 如果恰好是节气当日
      if (this.jieQiMonth[jieQi][0] === 0 && nlMonthVal === 12) {
        const year = this.lnYear() - 3;  // 虽然农历已经是腊月，但是已经立春，所以年加一
        const G = year % 10;
        const Z = year % 12;
        nlYear = GAN[G] + ZHI[Z];
        nlMonth = 0;
      } else {
        nlYear = this.gzYearValue;
        nlMonth = this.jieQiMonth[jieQi][0];
      }
    } else {  // 如果不是节气日，则循环判断后一个分月节气是什么
      nlYear = this.gzYearValue;
      nlMonth = 0;
      for (let i = -1; i >= -40; i--) {
        const varDays = new Date(ct.getTime() + i * 24 * 60 * 60 * 1000);
        const jieQiCheck = this.nlJie(varDays);
        if (jieQiCheck.length > 0 && this.jieQiOdd.includes(jieQiCheck)) {
          if (this.jieQiMonth[jieQiCheck][0] > 0) {
            nlMonth = this.jieQiMonth[jieQiCheck][0];
          } else if (this.jieQiMonth[jieQiCheck][0] === 0 && nlMonthVal === 12) {
            const year = this.lnYear() - 3;
            const G = year % 10;
            const Z = year % 12;
            nlYear = GAN[G] + ZHI[Z];
            nlMonth = 0;
          } else {
            nlMonth = 0;
          }
          break;
        }
      }
    }

    const ganStr = GAN.join('');
    const monthNum = (ganStr.indexOf(nlYear[0]) + 1) * 2 + nlMonth + 1;
    let M = monthNum % 10;
    if (M === 0) {
      M = 10;
    }
    
    // 查找对应的地支
    let monthZhi = "寅"; // 默认立春对应寅月
    for (const [jieQiName, [monthIndex, zhi]] of Object.entries(this.jieQiMonth)) {
      if (monthIndex === nlMonth) {
        monthZhi = zhi;
        break;
      }
    }
    
    const gzMonth = GAN[M - 1] + monthZhi;
    return gzMonth;
  }

  /**
   * @brief 计算干支纪日
   * @return {string} 干支纪日字符串，如"戊申"
   */
  gzDay() {
    const ct = this.localtime;
    const C = Math.floor(ct.getFullYear() / 100);  // 取世纪数
    let y = ct.getFullYear() % 100;  // 取年份后两位（若为1月、2月则当前年份减一）
    y = (ct.getMonth() === 0 || ct.getMonth() === 1) ? y - 1 : y;
    let M = ct.getMonth() + 1;  // 取月份（若为1月、2月则分别按13、14来计算）
    M = (ct.getMonth() === 0 || ct.getMonth() === 1) ? M + 12 : M;
    const d = ct.getDate();  // 取日数
    const i = (ct.getMonth() + 1) % 2 === 1 ? 0 : 6;  // 取i（奇数月i=0，偶数月i=6）

    // 计算天干（补减1）
    let G = 4 * C + Math.floor(C / 4) + 5 * y + Math.floor(y / 4) + Math.floor(3 * (M + 1) / 5) + d - 3 - 1;
    G = G % 10;
    // 计算地支（补减1）
    let Z = 8 * C + Math.floor(C / 4) + 5 * y + Math.floor(y / 4) + Math.floor(3 * (M + 1) / 5) + d + 7 + i - 1;
    Z = Z % 12;

    return GAN[G] + ZHI[Z];
  }

  /**
   * @brief 计算干支纪时（时辰）
   * 时干数 = ((日干 % 5)*2 + 时辰 -2) % 10
   * @return {string} 干支纪时字符串，如"壬子"
   */
  gzHour() {
    const ct = this.localtime;
    // 计算地支
    let Z = Math.round((ct.getHours() / 2) + 0.1) % 12;  // 之所以加0.1是因为round的bug
    const gzDayValue = this.gzDay();
    const gzDayNum = GAN.indexOf(gzDayValue[0]) + 1;
    let gzDayYu = gzDayNum % 5;
    const hourNum = Z + 1;
    if (gzDayYu === 0) {
      gzDayYu = 5;
    }
    let gzHourNum = (gzDayYu * 2 - 1 + hourNum - 1) % 10;
    if (gzHourNum === 0) {
      gzHourNum = 10;
    }
    
    return GAN[gzHourNum - 1] + ZHI[Z];
  }

  // ==================== 辅助方法 ====================

  /**
   * @brief 获取农历年份
   * @return {number} 农历年份整数
   */
  lnYear() {
    const [year, , ] = this.lnDate();
    return year;
  }

  /**
   * @brief 获取农历月份
   * @return {number} 农历月份整数
   */
  lnMonth() {
    const [, month, ] = this.lnDate();
    return month;
  }

  /**
   * @brief 计算农历日期
   * @return {number[]} 农历日期数组[年、月、日]
   */
  lnDate() {
    let deltaDays = this.dateDiff();

    // 阳历1901年2月19日为阴历1901年正月初一
    // 阳历1901年1月1日到2月19日共有49天
    if (deltaDays < 49) {
      const year = this.START_YEAR - 1;
      if (deltaDays < 19) {
        const month = 11;
        const day = 11 + deltaDays;
        return [year, month, day];
      } else {
        const month = 12;
        const day = deltaDays - 18;
        return [year, month, day];
      }
    }

    // 下面从阴历1901年正月初一算起
    deltaDays -= 49;
    let year = this.START_YEAR;
    let month = 1;
    let day = 1;
    
    // 计算年
    let tmp = this.lunarYearDays(year);
    while (deltaDays >= tmp) {
      deltaDays -= tmp;
      year += 1;
      tmp = this.lunarYearDays(year);
    }

    // 计算月
    let [foo, tmp2] = this.lunarMonthDays(year, month);
    while (deltaDays >= tmp2) {
      deltaDays -= tmp2;
      if (month === this.getLeapMonth(year)) {
        [tmp2, foo] = this.lunarMonthDays(year, month);
        if (deltaDays < tmp2) {
          return [0, 0, 0];
        }
        deltaDays -= tmp2;
      }
      month += 1;
      [foo, tmp2] = this.lunarMonthDays(year, month);
    }

    // 计算日
    day += deltaDays;
    return [year, month, day];
  }

  /**
   * @brief 获取当前日期的节气
   * @return {string} 节气名称字符串
   */
  lnJie() {
    const ct = this.localtime;
    const year = ct.getFullYear();
    for (let i = 0; i < 24; i++) {
      const delta = this.julianDay() - this.julianDayOfLnJie(year, i);
      if (delta >= -0.5 && delta <= 0.5) {
        return this.jie.slice(i * 2, (i + 1) * 2);
      }
    }
    return '';
  }

  /**
   * @brief 获取指定日期的节气
   * @param {Date} dt - Date对象
   * @return {string} 节气名称字符串
   */
  nlJie(dt) {
    const year = dt.getFullYear();
    for (let i = 0; i < 24; i++) {
      const delta = this.rulianDay(dt) - this.julianDayOfLnJie(year, i);
      if (delta >= -0.5 && delta <= 0.5) {
        return this.jie.slice(i * 2, (i + 1) * 2);
      }
    }
    return '';
  }

  // ==================== 私有方法 ====================

  /**
   * @brief 计算与1901/01/01的天数差
   * @return {number} 天数差
   */
  dateDiff() {
    const baseDate = new Date(1901, 0, 1); // 1901年1月1日
    return Math.floor((this.localtime.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));
  }

  /**
   * @brief 获取指定农历年份的闰月
   * @param {number} lunarYear - 农历年份
   * @return {number} 闰月月份，无闰月返回0
   */
  getLeapMonth(lunarYear) {
    const flag = this.gLunarMonth[Math.floor((lunarYear - this.START_YEAR) / 2)];
    if ((lunarYear - this.START_YEAR) % 2) {
      return flag & 0x0f;
    } else {
      return flag >> 4;
    }
  }

  /**
   * @brief 计算农历月份天数
   * @param {number} lunarYear - 农历年份
   * @param {number} lunarMonth - 农历月份
   * @return {number[]} [闰月天数, 正常月天数]
   */
  lunarMonthDays(lunarYear, lunarMonth) {
    if (lunarYear < this.START_YEAR) {
      return [0, 30];
    }

    let high = 0;
    let low = 29;
    let iBit = 16 - lunarMonth;

    if (lunarMonth > this.getLeapMonth(lunarYear) && this.getLeapMonth(lunarYear)) {
      iBit -= 1;
    }

    if (this.gLunarMonthDay[lunarYear - this.START_YEAR] & (1 << iBit)) {
      low += 1;
    }

    if (lunarMonth === this.getLeapMonth(lunarYear)) {
      if (this.gLunarMonthDay[lunarYear - this.START_YEAR] & (1 << (iBit - 1))) {
        high = 30;
      } else {
        high = 29;
      }
    }

    return [high, low];
  }

  /**
   * @brief 计算农历年总天数
   * @param {number} year - 农历年份
   * @return {number} 年总天数
   */
  lunarYearDays(year) {
    let days = 0;
    for (let i = 1; i <= 12; i++) {
      const [high, low] = this.lunarMonthDays(year, i);
      days += high;
      days += low;
    }
    return days;
  }

  /**
   * @brief 计算当前日期的儒略日
   * @return {number} 儒略日数值
   */
  julianDay() {
    const ct = this.localtime;
    let year = ct.getFullYear();
    let month = ct.getMonth() + 1;
    const day = ct.getDate();

    if (month <= 2) {
      month += 12;
      year -= 1;
    }

    let B = Math.floor(year / 100);
    B = 2 - B + Math.floor(year / 400);

    const dd = day + 0.5000115740;  // 本日12:00后才是儒略日的开始
    return Math.floor(365.25 * (year + 4716) + 0.01) + Math.floor(30.60001 * (month + 1)) + dd + B - 1524.5;
  }

  /**
   * @brief 计算指定日期的儒略日
   * @param {Date} dt - Date对象
   * @return {number} 儒略日数值
   */
  rulianDay(dt) {
    let year = dt.getFullYear();
    let month = dt.getMonth() + 1;
    const day = dt.getDate();
    
    if (month <= 2) {
      month += 12;
      year -= 1;
    }

    let B = Math.floor(year / 100);
    B = 2 - B + Math.floor(year / 400);

    const dd = day + 0.5000115740;
    return Math.floor(365.25 * (year + 4716) + 0.01) + Math.floor(30.60001 * (month + 1)) + dd + B - 1524.5;
  }

  /**
   * @brief 计算指定年份节气的儒略日
   * @param {number} year - 年份
   * @param {number} st - 节气序号
   * @return {number} 节气儒略日
   */
  julianDayOfLnJie(year, st) {
    const sStAccInfo = [
      0.00, 1272494.40, 2548020.60, 3830143.80, 5120226.60, 6420865.80,
      7732018.80, 9055272.60, 10388958.00, 11733065.40, 13084292.40, 14441592.00,
      15800560.80, 17159347.20, 18513766.20, 19862002.20, 21201005.40, 22529659.80,
      23846845.20, 25152606.00, 26447687.40, 27733451.40, 29011921.20, 30285477.60
    ];

    // 已知1900年小寒时刻为1月6日02:05:00
    const base1900SlightColdJD = 2415025.5868055555;

    if (st < 0 || st > 24) {
      return 0.0;
    }

    const stJd = 365.24219878 * (year - 1900) + sStAccInfo[st] / 86400.0;
    return base1900SlightColdJD + stJd;
  }
}

// **************************** 干支计算辅助函数 ****************************

/**
 * @brief 计算指定日期的年柱干支（按照2.py精确算法）
 * @param {Date} date - JS Date 对象
 * @return {string} 年柱干支
 */
function getYearGanzhi(date) {
  const gz = new GanZhi(date);
  return gz.gzYear();
}

/**
 * @brief 计算指定日期的月柱干支（按照2.py精确算法）
 * @param {Date} date - JS Date 对象
 * @return {string} 月柱干支
 */
function getMonthGanzhi(date) {
  const gz = new GanZhi(date);
  gz.gzYear(); // 需要先计算年干支
  return gz.gzMonth();
}

/**
 * @brief 计算指定日期的日柱干支（按照2.py精确算法）
 * @param {Date} date - JS Date 对象
 * @return {string} 日柱干支
 */
function getDayGanzhi(date) {
  const gz = new GanZhi(date);
  return gz.gzDay();
}

/**
 * @brief 计算指定日期的时柱干支（按照2.py精确算法）
 * @param {Date} date - JS Date 对象
 * @return {string} 时柱干支
 */
function getHourGanzhi(date) {
  const gz = new GanZhi(date);
  return gz.gzHour();
}

// **************************** 辅助函数 ****************************

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

/**
 * @brief 根据客户端上传的本地时间信息生成 Date 对象。
 *
 * Cloudflare Workers 运行环境固定使用 UTC 时区，这会导致直接调用
 * `new Date()` 获取到的小时数与用户浏览器看到的不一致。
 * 为保证卦象推算使用"用户设备时间"作为基准，前端会上传：
 *   - ts        : `Date.now()` 的毫秒时间戳（UTC 基准）。
 *   - tz_offset : `Date#getTimezoneOffset()` 的返回值，单位 **分钟**，
 *                 其含义为 `UTC – Local`。
 *
 * 有了上述两项，即可通过
 *   localDate = new Date(ts - tz_offset * 60_000)
 * 将时间从 UTC 还原为用户本地时区下的实际时间。
 *
 * @param {{ts:number, tz_offset:number}=} clientTime 客户端时间信息，
 *        若为空或参数非法，则回退至 `new Date()`（Workers 时间）。
 * @return {Date} 表示用户本地时间的 Date 对象。
 */
function resolveClientTime(clientTime) {
  if (
    clientTime &&
    typeof clientTime.ts === "number" &&
    typeof clientTime.tz_offset === "number" &&
    Number.isFinite(clientTime.ts) &&
    Number.isFinite(clientTime.tz_offset)
  ) {
    // 转换为用户本地时间
    return new Date(clientTime.ts - clientTime.tz_offset * 60_000);
  }
  // 回退：使用 Workers 运行时时间（UTC）
  return new Date();
}

// **************************** 主处理逻辑 ****************************
/**
 * @brief SSE 流式推送小六壬解卦结果（使用用户本地时间）。
 * @param {Object}  params                 - 请求参数。
 * @param {number[]} params.numbers        - 三个数字。
 * @param {string}  params.question        - 用户问题。
 * @param {boolean} params.showReasoning   - 是否推送推理过程。
 * @param {string}  params.apiKey          - 前端传递的 API Key。
 * @param {string}  params.model           - 前端传递的模型名称。
 * @param {string}  params.endpoint        - 前端传递的 API 端点。
 * @param {{ts:number,tz_offset:number}=} [params.clientTime] - 用户设备时间信息。
 * @param {Record<string,string>} env      - Workers 环境变量。
 * @return {Promise<Response>} SSE Response。
 */
async function streamDivination({ numbers, question, showReasoning, apiKey: clientApiKey, model: clientModel, endpoint: clientEndpoint, clientTime }, env) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 在后台异步执行全部推流逻辑，避免阻塞 Response 返回
  (async () => {
    try {
      // ---------- 1. 计算卦象 & 八字 ----------
      const now = resolveClientTime(clientTime);
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

      // ------------------ 处理客户端/服务端配置 ------------------
      /**
       * @brief 统一获取 API 配置。
       */
      const apiKey = clientApiKey;
      if (!apiKey) throw new Error("未配置 apiKey");

      const endpoint = clientEndpoint;
      if (!endpoint) throw new Error("未配置 endpoint");

      const model = clientModel;
      if (!model) throw new Error("未配置 model");

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
    const { numbers, question, show_reasoning = true, apiKey: clientApiKey, model: clientModel, endpoint: clientEndpoint, clientTime } = body || {};
    if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
      return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
    }
    // 走流式分支
    return streamDivination({ numbers, question, showReasoning: show_reasoning, apiKey: clientApiKey, model: clientModel, endpoint: clientEndpoint, clientTime }, env);
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

  const { numbers, question, show_reasoning = true, apiKey: clientApiKey, model: clientModel, endpoint: clientEndpoint, clientTime } = body || {};
  if (!Array.isArray(numbers) || numbers.length !== 3 || !question) {
    console.warn(`[divination] ⚠️ 参数不合法: numbers=${JSON.stringify(numbers)}, question=${question}`);
    return new Response("参数错误：需包含 numbers(3 个) 与 question", { status: 400 });
  }

  // ---------- 2. 计算干支与卦象 ----------
  const now = resolveClientTime(clientTime);
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
  const apiKey = clientApiKey;
  if (!apiKey) return new Response("未配置 apiKey", { status: 400 });

  const endpoint = clientEndpoint;
  if (!endpoint) return new Response("未配置 endpoint", { status: 400 });

  const model = clientModel;
  if (!model) return new Response("未配置 model", { status: 400 });

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