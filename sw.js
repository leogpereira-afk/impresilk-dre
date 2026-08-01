// sw.js — Service Worker da PWA. Estratégia NETWORK-FIRST.
//
// ▶ A cada mudança nos arquivos, SUBA o número do CACHE (v1 → v2 → …). No
//   evento "activate" apagamos todo cache com nome diferente, o que força os
//   aparelhos a baixarem a versão nova (evita ficar preso em arquivos antigos).
const CACHE = 'app-shell-v45';

// Arquivos estáticos pré-cacheados na instalação (o "app shell"). São o mínimo
// para o app abrir offline. CDNs (Chart.js, fonts) não entram aqui: serão
// cacheados sob demanda pelo fetch network-first abaixo.
const SHELL = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './data.js',
  './config.js',
  './logo.png',
];

// INSTALL: pré-cacheia o shell e assume o controle imediatamente.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// ACTIVATE: remove caches antigos (qualquer nome != CACHE atual) e assume o
// controle das abas já abertas.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// FETCH: network-first.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Só lidamos com GET. POST/PUT (chamadas à API) passam direto pela rede.
  if (req.method !== 'GET') return;

  // NUNCA cachear as funções: os dados são responsabilidade da fila do cliente
  // (IndexedDB/sync), não do cache de arquivos. Deixa passar direto.
  if (url.hostname.endsWith('supabase.co')) return;
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  e.respondWith(
    fetch(req)
      .then((resp) => {
        // Online: atualiza o cache com a versão fresca (só respostas válidas
        // do nosso próprio domínio; respostas opacas de CDN também são úteis).
        if (resp && resp.status === 200 && (url.origin === self.location.origin)) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(async () => {
        // Offline: serve do cache. Navegação (abrir o app) cai no index.html.
        const cacheado = await caches.match(req);
        if (cacheado) return cacheado;
        if (req.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      })
  );
});
