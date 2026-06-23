// config.js — configuração do CLIENTE (vai ao navegador).
//
// ⚠️ ATENÇÃO: este arquivo é servido ao browser, então TUDO aqui é PÚBLICO e
// visível no DevTools. O TOKEN abaixo só barra acesso casual/bots — NÃO é
// segurança forte. Para dados sensíveis, troque por login real (sessão/JWT)
// com o segredo morando apenas no servidor.
//
// O MESMO valor precisa estar na variável de ambiente TOKEN do painel Netlify.
// Se divergirem, todas as chamadas retornam 401.
const TOKEN = 'tok_55606031e843116d7d944c7c1503afd663e742cc';

// Endpoint do backend (função roteadora). Caminho relativo: funciona em
// qualquer domínio onde o site estiver publicado.
const API = '/.netlify/functions/os';

// Helper de chamada: injeta o header x-token e o JSON da ação.
async function api(action, payload = {}) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': TOKEN },
    body: JSON.stringify({ action, ...payload }),
  });
  return r.json();
}
