// sw.js — Service Worker da PWA. Estratégia NETWORK-FIRST.
//
// ▶ A cada mudança nos arquivos, SUBA o número do CACHE (v1 → v2 → …). No
//   evento "activate" apagamos todo cache com nome diferente, o que força os
//   aparelhos a baixarem a versão nova (evita ficar preso em arquivos antigos).
const CACHE = 'app-shell-v63';

// O MESMO número precisa estar no ?v= dos <link>/<script> do index.html. O
// Service Worker só manda no que passa por ele; o cache HTTP do navegador é
// outra camada, e sem o ?v= ele continua servindo CSS/JS velhos depois do
// deploy — foi assim que a tela ficou desencontrada do código na v46.
const V = CACHE.split('-v')[1];

// Arquivos estáticos pré-cacheados na instalação (o "app shell"). São o mínimo
// para o app abrir offline. CDNs (Chart.js, fonts) não entram aqui: serão
// cacheados sob demanda pelo fetch network-first abaixo.
const SHELL = [
  './',
  './index.html',
  `./app.js?v=${V}`,
  `./styles.css?v=${V}`,
  `./data.js?v=${V}`,
  `./config.js?v=${V}`,
  `./auth.js?v=${V}`,
  './logo.png',
  './icone-192.png',
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
        // './index.html', nao '/index.html': no GitHub Pages o app mora em
        // /impresilk-dre/, e a barra sozinha aponta para a RAIZ do dominio --
        // que nao esta no cache. Offline, abrir o app dava tela em branco.
        if (req.mode === 'navigate') {
          return (await caches.match('./index.html')) || Response.error();
        }
        return Response.error();
      })
  );
});
