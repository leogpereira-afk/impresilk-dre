// config.js — configuração do CLIENTE (vai ao navegador).
//
// ⚠️ TUDO neste arquivo é PÚBLICO: ele é servido ao navegador e qualquer pessoa
// lê no código-fonte da página. Por isso NÃO existe mais token aqui.
//
// Até 05/08/2026 havia um `const TOKEN = 'tok_...'` nesta linha, e era ele que
// autorizava os dados no servidor. Resultado: qualquer pessoa que abrisse o
// código-fonte baixava o DRE inteiro — receita, custo e resultado mês a mês —
// sem login nenhum. Foi confirmado na prática antes de consertar.
//
// Agora quem autoriza é o CRACHÁ da pessoa (o mesmo que abre a tela), que vive
// no localStorage e é assinado por um segredo que só o servidor conhece. O
// token antigo foi GIRADO: remover do arquivo não bastaria, porque ele já
// estava público e continua nas cópias em cache de quem já visitou.

// Endpoint do backend (função roteadora). Caminho relativo: funciona em
// qualquer domínio onde o site estiver publicado.
// Backend: Edge Functions do Supabase (antes: Netlify Functions no mesmo
// dominio). Nomes com prefixo dre- porque o projeto e compartilhado com os
// outros sistemas da Impresilk.
const API_BASE = 'https://heveemylixartyijxewh.supabase.co/functions/v1';
const API_FN = { os: 'dre-sync', financas: 'dre-financas' };
const API = API_BASE + '/dre-sync';

// Helper de chamada: injeta o header x-token e o JSON da ação.
// Timeout de 15s via AbortController: em sinal fraco, navigator.onLine pode
// dizer "online" mas o fetch trava para sempre — o timeout vira um erro de
// rede tratável (a fila retenta no próximo gatilho), em vez de pendurar.
async function api(action, payload = {}, timeoutMs = 15000) {
  return apiFn('os', action, payload, timeoutMs);
}

// Versão genérica: chama qualquer função do projeto (os, financas…) com o
// mesmo x-token e timeout. Usada pela integração Mubisys (função 'financas').
async function apiFn(fn, action, payload = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(API_BASE + '/' + (API_FN[fn] || fn), {
      method: 'POST',
      headers: Object.assign(
        { 'content-type': 'application/json' },
        // O crachá é lido na hora da chamada, não guardado numa constante: ele
        // muda quando a pessoa entra, sai ou troca de senha.
        (typeof AUTH !== 'undefined' && AUTH.cracha()) ? { authorization: 'Bearer ' + AUTH.cracha() } : {}
      ),
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl.signal,
    });
    return r.json();
  } finally {
    clearTimeout(t);
  }
}
