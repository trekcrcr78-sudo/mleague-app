// ネットワーク優先・圏外ならキャッシュ（複数ファイルの新旧が混ざらないように）
const CACHE = "mleague-v6";
const SHELL = [
  "./", "index.html", "style.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon.svg",
  "js/main.js", "js/store.js", "js/model.js", "js/format.js", "js/dom.js", "js/actions.js", "js/components.js",
  "js/chart.js", "js/sheets.js", "js/views/schedule.js", "js/views/standings.js", "js/views/players.js", "js/views/results.js",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const key = url.pathname.endsWith(".json") ? url.pathname.split("/").pop() : e.request; // ?t= を無視して保存
  // cache: "no-cache" = ブラウザの短期キャッシュ（GitHub Pages は最大10分）を使わず、毎回サーバーに更新有無を確認する
  e.respondWith(fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key)));
});
