/**
 * @file update-sw-cache-version.js
 * @brief 自动更新 static/service-worker.js 中的 CACHE_VERSION，避免忘记手动递增。
 * @details 使用当前时间戳（36 进制）生成唯一版本号，如 `vkt3f4o`。在 CI/CD、npm script 中调用即可。
 *
 * @usage
 *   "scripts": {
 *     "update-cache-version": "node scripts/update-sw-cache-version.js",
 *     "dev": "npm run update-cache-version && wrangler dev",
 *     "build": "npm run update-cache-version && wrangler publish"
 *   }
 *
 * @note 仅替换首个匹配的 `const CACHE_VERSION = 'v*';`，若未匹配将退出并抛错。
 *
 * @copyright Copyright (c) 2025
 */

// ------------------------------
// 原生 Node.js 依赖
// ------------------------------
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * @brief 生成形如 `vkt3f4o` 的版本号。
 *        使用 Date.now() 转 36 进制，可保证单调递增且足够短。
 * @return {string} 新版本号 (带前缀 v)
 */
function genVersion() {
  return `v${Date.now().toString(36)}`;
}

/**
 * @brief 主执行入口
 */
function main() {
  // 解析路径
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const swPath = path.resolve(__dirname, '../static/service-worker.js');

  if (!fs.existsSync(swPath)) {
    console.error('[update-cache-version] 找不到 service-worker.js:', swPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(swPath, 'utf8');
  const newVersion = genVersion();

  // 使用正则替换版本号；仅替换首个匹配，确保安全
  const updated = raw.replace(/const\s+CACHE_VERSION\s*=\s*'v[^']*';/, `const CACHE_VERSION = '${newVersion}';`);

  if (updated === raw) {
    console.error('[update-cache-version] 未在 service-worker.js 中找到 CACHE_VERSION 声明，脚本终止。');
    process.exit(1);
  }

  fs.writeFileSync(swPath, updated);

  // 输出提示
  console.log(`[update-cache-version] Service Worker 缓存版本已更新为 ${newVersion}`);
}

// ------------------------------
// 执行
// ------------------------------
main(); 