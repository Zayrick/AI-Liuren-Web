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
const CACHE_VERSION = 'v1';
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
  '/icon.png',
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
      // 命中缓存直接返回
      if (cachedResponse) return cachedResponse;
      // 未命中则回源并缓存
      return fetch(event.request)
        .then((networkResponse) => {
          // 若响应非法直接返回
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }
          // 克隆响应流便于后续使用
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => {
          // 网络请求失败（离线）时，可返回离线占位页或静态资源；此处简单返回404。
          return new Response('离线状态，且资源未缓存。', { status: 404 });
        });
    })
  );
}); 