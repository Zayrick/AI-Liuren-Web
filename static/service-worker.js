/**
 * @file service-worker.js
 * @brief PWA Service Worker，用于离线缓存静态资源，提升 iOS Safari Progressive Web App 体验。
 *
 * 该实现采用简单的 Cache First 策略：
 * 1. 安装阶段预缓存核心静态文件（index.html、样式、脚本、manifest 等）。
 * 2. 请求拦截阶段优先读取缓存，若缓存未命中则回源网络并缓存最新响应。
 * 3. 激活阶段自动清理旧版本缓存，避免占用额外存储空间。
 *
 * 注意：iOS Safari 自 14.5 起支持 Service Worker。
 */

// =============================
// 常量定义
// =============================

/** 当前缓存版本。更新资源清单时应同时更新此版本号，触发激活阶段的缓存刷新。 */
const CACHE_VERSION = 'vmcdaydz2';
/** 实际使用的 Cache Storage 名称。*/
const CACHE_NAME = `liuyao-ai-${CACHE_VERSION}`;

/**
 * 需要在安装阶段预缓存的静态资源列表。
 * 注意：所有路径以根路径为基准，确保与生产环境一致。
 */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/web-manifest-combined.json',
  '/icon.png',
  '/assets/css/style.css',
  '/assets/js/app.js',
  '/service-worker.js'
];

// =============================
// 安装阶段：预缓存核心静态文件
// =============================
self.addEventListener('install', /**
 * 安装事件处理。
 * @param {ExtendableEvent} event 事件对象
 */
(event) => {
  // 安装完成前预缓存关键资源
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  // 跳过等待阶段，立即进入激活状态
  self.skipWaiting();
});

// =============================
// 激活阶段：清理旧缓存
// =============================
self.addEventListener('activate', /**
 * 激活事件处理。
 * @param {ExtendableEvent} event 事件对象
 */
(event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key); // 删除旧版本缓存
          }
        })
      )
    )
  );
  // 立即接管所有客户端
  self.clients.claim();
});

// =============================
// Fetch 拦截：Cache First 策略
// =============================
self.addEventListener('fetch', /**
 * Fetch 事件处理。
 * @param {FetchEvent} event 事件对象
 */
(event) => {
  // 仅处理 GET 请求，其他方法直接跳过
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // ① 命中缓存直接返回
      if (cachedResponse) return cachedResponse;

      // ② 未命中则回源；此处显式处理 3xx Redirect 响应，修复 iOS/Safari "Response served by service worker has redirections" Bug
      return fetch(event.request)
        .then((networkResponse) => {
          // ---------- SAFARI BUGFIX BEGIN ----------
          /**
           * 若后端返回 301/302/307 等重定向，iOS Safari 在 PWA 窗口下会因 Service Worker 直接向客户端返回
           * 3xx 响应而报错。此处检测到重定向后，主动发起二次请求跟随至最终资源，再交给浏览器。
           *
           * @see https://bugs.webkit.org/show_bug.cgi?id=225083
           */
          if (
            networkResponse &&
            (networkResponse.redirected || 
             (networkResponse.status >= 300 && networkResponse.status < 400) ||
             networkResponse.type === 'opaqueredirect')
          ) {
            // 获取最终目标URL，优先使用networkResponse.url，回退到Location header
            let finalUrl = networkResponse.url;
            if (!finalUrl || finalUrl === event.request.url) {
              const locationHeader = networkResponse.headers.get('location');
              if (locationHeader) {
                finalUrl = new URL(locationHeader, event.request.url).href;
              }
            }

            // 如果获取到有效的目标URL，发起二次请求
            if (finalUrl && finalUrl !== event.request.url) {
              return fetch(finalUrl, {
                method: 'GET',
                credentials: event.request.credentials,
                cache: 'no-cache'
              }).then((finalResponse) => {
                // 避免再次将重定向结果写入缓存，只缓存最终的200响应
                if (finalResponse && finalResponse.status === 200 && finalResponse.type !== 'opaque') {
                  caches
                    .open(CACHE_NAME)
                    .then((cache) => cache.put(event.request, finalResponse.clone()))
                    .catch(() => {}); // 忽略缓存错误
                }
                return finalResponse;
              }).catch(() => {
                // 如果二次请求失败，尝试返回原始响应
                return networkResponse;
              });
            }
          }
          // ---------- SAFARI BUGFIX END ----------

          // ③ 常规 200 响应：写入缓存后返回
          if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone)).catch(() => {});
          }

          return networkResponse;
        })
        .catch(() => {
          // ④ 网络离线且未缓存：返回占位响应
          return new Response('离线状态，且资源未缓存。', { status: 404 });
        });
    })
  );
}); 