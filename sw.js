// sw.js — Service Worker da PWA. Estratégia NETWORK-FIRST.
//
// ▶ A cada mudança nos arquivos, SUBA o número do CACHE (v1 → v2 → …). No
//   evento "activate" apagamos todo cache com nome diferente, o que força os
//   aparelhos a baixarem a versão nova (evita ficar preso em arquivos antigos).
const CACHE = 'dre-shell-v135';

// O MESMO número precisa estar no ?v= dos <link>/<script> do index.html. O
// Service Worker só manda no que passa por ele; o cache HTTP do navegador é
// outra camada, e sem o ?v= ele continua servindo CSS/JS velhos depois do
// deploy — foi assim que a tela ficou desencontrada do código na v46.
const V = CACHE.split('-v')[1];

// Arquivos estáticos pré-cacheados na instalação (o "app shell"). São o mínimo
// para o app abrir offline. Outras origens passam direto pela rede; nada de CDN
// é guardado.
const SHELL = [
  `./plano-contas.js?v=${V}`,
  `./auditoria.js?v=${V}`,
  `./fechamento.js?v=${V}`,
  `./cache-local.js?v=${V}`,
  `./comparativos.js?v=${V}`,
  `./gestao.js?v=${V}`,
  `./parametros.js?v=${V}`,
  `./dfc.js?v=${V}`,
  `./compacto.css?v=${V}`,
  `./graficos.css?v=${V}`,
  './',
  './index.html',
  `./indicadores.js?v=${V}`,
  `./indicadores-modelo.mjs?v=${V}`,
  `./indicadores.css?v=${V}`,
  `./app.js?v=${V}`,
  `./coleta-ui.js?v=${V}`,
  `./cfo-modelo.js?v=${V}`,
  `./cfo.js?v=${V}`,
  `./pdf-cfo.js?v=${V}`,
  `./cfo.css?v=${V}`,
  `./styles.css?v=${V}`,
  `./financeiro.js?v=${V}`,
  `./graficos.js?v=${V}`,
  `./dre-modelo.js?v=${V}`,
  `./demonstrativos.js?v=${V}`,
  `./glossario.js?v=${V}`,
  `./config.js?v=${V}`,
  `./auth.js?v=${V}`,
  './logo.webp',
  './inter-variable.woff2',
  './icone-192.png',
];

// Gerador de PDF num cache próprio, que não muda de nome a cada versão: o
// activate só apaga dre-shell-v*, então os ~400 KB do jsPDF são baixados uma
// vez e o PDF funciona offline. Trocar o nome só quando o vendor mudar.
const VENDOR='dre-vendor-jspdf-1',VENDOR_ARQ=['./vendor/jspdf.umd.min.js','./vendor/jspdf.plugin.autotable.min.js'];

// INSTALL: pré-cacheia o shell e assume o controle imediatamente.
// cache:'reload' só no que muda a cada versão (?v= e a página): sem isto o SW
// guardaria o que estava no cache HTTP do navegador (o Pages manda max-age=600)
// e serviria a versão velha até o próximo bump. Logo, fonte e ícone não mudam
// de versão para versão e podem vir do cache HTTP.
// O vendor do PDF entra no mesmo waitUntil, mas uma falha nele não derruba a
// instalação (o PDF só fica sem funcionar offline).
self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: /\?v=|^\.\/(index\.html)?$/.test(u) ? 'reload' : 'default' })))),
    caches.open(VENDOR).then(async (c) => { for (const u of VENDOR_ARQ) if (!(await c.match(u))) await c.add(u).catch(() => {}); }).catch(() => {}),
  ]).then(() => self.skipWaiting()));
});

// ACTIVATE: remove caches antigos (qualquer nome != CACHE atual) e assume o
// controle das abas já abertas.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(async nomes => {
      const scope=new URL('./',self.location).href;
      for(const name of nomes){
        if(name===CACHE)continue;
        if(name.startsWith('dre-shell-v'))await caches.delete(name);
        else if(/^app-shell-v\d+$/.test(name)){
          // Nomes antigos eram compartilhados com outros apps do mesmo domínio.
          const cache=await caches.open(name);
          for(const req of await cache.keys())if(req.url.startsWith(scope))await cache.delete(req);
          if(!(await cache.keys()).length)await caches.delete(name);
        }
      }
    })
      .then(() => self.clients.claim())
  );
});

// FETCH: network-first.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Só lidamos com GET. POST/PUT (chamadas à API) passam direto pela rede.
  if (req.method !== 'GET') return;
  if (url.pathname.endsWith('/data.js')) return;
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL('./',self.location).pathname)) return;

  e.respondWith(
    fetch(req)
      .then((resp) => {
        // Online: atualiza o cache com a versão fresca (só respostas válidas
        // do nosso próprio domínio).
        if (resp && resp.status === 200 && (url.origin === self.location.origin)) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(async () => {
        // Offline: serve do cache (o shell desta versão ou o vendor do PDF).
        // Navegação (abrir o app) cai no index.html.
        const cacheado = await caches.match(req);
        if (cacheado) return cacheado;
        const ownCache = await caches.open(CACHE);
        // './index.html', nao '/index.html': no GitHub Pages o app mora em
        // /impresilk-dre/, e a barra sozinha aponta para a RAIZ do dominio --
        // que nao esta no cache. Offline, abrir o app dava tela em branco.
        if (req.mode === 'navigate') {
          return (await ownCache.match('./index.html')) || Response.error();
        }
        return Response.error();
      })
  );
});
