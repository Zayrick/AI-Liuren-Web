/**
 * @file service-worker.js（精简版）
 * @description PWA Service Worker：Cache First + Safari Redirect Bug Fix。
 *
 * 主要流程：
 * 1. install：预缓存核心静态资源。
 * 2. activate：清理旧缓存。
 * 3. fetch：Cache First；并处理 iOS Safari 重定向问题。
 */

// =============================
// 常量
// =============================
const VERSION = 'vmduevwtv';
const CACHE_NAME = `liuyao-ai-${VERSION}`;

// 需预缓存的静态资源
const ASSETS = [
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
// install：预缓存
// =============================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// =============================
// activate：删除旧缓存
// =============================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// =============================
// fetch：Cache First + Redirect Fix
// =============================
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; // 非 GET 请求直接放行
  event.respondWith(cacheFirst(event.request));
});

/**
 * Cache First 策略处理请求。
 * @param {Request} request
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  // ① 命中缓存直接返回
  const cached = await cache.match(request);
  if (cached) return cached;

  // ② 网络请求（含 Safari 重定向修复）
  try {
    const response = await fetchWithRedirect(request);

    // ③ 成功响应写入缓存（仅限 200）
    if (response.ok && response.type !== 'opaque') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    // ④ 离线且未缓存
    return new Response('离线状态，且资源未缓存。', { status: 404 });
  }
}

/**
 * 处理 Safari Service Worker 重定向 Bug。
 * @param {Request} request
 */
async function fetchWithRedirect(request) {
  const response = await fetch(request);
  if (!needsRedirectFix(response)) return response;

  const finalUrl = resolveFinalUrl(response, request.url);
  if (!finalUrl || finalUrl === request.url) return response;

  return fetch(finalUrl, {
    method: 'GET',
    credentials: request.credentials,
    cache: 'no-cache'
  });
}

/**
 * 判断是否需要重定向修复。
 * @param {Response} response
 */
function needsRedirectFix(response) {
  return (
    response.redirected ||
    (response.status >= 300 && response.status < 400) ||
    response.type === 'opaqueredirect'
  );
}

/**
 * 获取最终资源 URL。
 * @param {Response} response
 * @param {string} fallback 原始 URL
 */
function resolveFinalUrl(response, fallback) {
  if (response.url && response.url !== fallback) return response.url;
  const location = response.headers.get('location');
  return location ? new URL(location, fallback).href : null;
}
