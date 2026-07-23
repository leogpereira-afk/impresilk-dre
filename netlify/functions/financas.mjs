// netlify/functions/financas.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Conector com a API do Mubisys para LER o financeiro (contas a pagar/receber,
// contas bancárias). Padrão testado no PCP (pcpimpresilk), adaptado para a
// Função v2 (Request/Response) usada neste projeto.
//
// As credenciais do Mubisys (publicKey + Access-Token) ficam SÓ no servidor,
// no store 'integracoes' do Netlify Blobs (chave 'mubisys'), cadastradas pela
// tela de admin do app (ação salvarConfig). NUNCA vão ao navegador — o front
// fala apenas com esta função, protegida pelo mesmo x-token (process.env.TOKEN)
// do os.mjs. Fallback por env: MUBISYS_PUBLIC_KEY / MUBISYS_TOKEN / MUBISYS_BASE.
// ─────────────────────────────────────────────────────────────────────────────
import { getStore } from '@netlify/blobs';

const DEFAULT_BASE = 'https://api.mubisys.com/api';

function store(name) {
  try { return getStore(name); }
  catch {
    const siteID = process.env.BLOBS_SITE_ID, token = process.env.BLOBS_TOKEN;
    if (!siteID || !token) throw new Error('Blobs sem contexto e sem BLOBS_SITE_ID/BLOBS_TOKEN');
    return getStore({ name, siteID, token });
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

// Resolve credenciais: primeiro o cadastro feito no app (Blobs), depois env vars.
async function getCreds() {
  let cfg = null;
  try { cfg = await store('integracoes').get('mubisys', { type: 'json' }); } catch {}
  cfg = cfg || {};
  return {
    publicKey:   cfg.publicKey   || process.env.MUBISYS_PUBLIC_KEY || '',
    accessToken: cfg.accessToken || process.env.MUBISYS_TOKEN || '',
    base:        (cfg.base || process.env.MUBISYS_BASE || DEFAULT_BASE).replace(/\/+$/, ''),
  };
}

// A API pode devolver array direto ou embrulhado ({data:[...]}, {items:[...]}).
function extrairLista(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && data.data) return [data.data];
  return [];
}

// Janela de datas: usa a informada; senão, o mês corrente inteiro é responsabilidade
// do cliente (aqui só garantimos AAAA-MM-DD válidos se vierem).
function janela(body) {
  return { datainicial: body.datainicial || '', datafinal: body.datafinal || '' };
}

// Busca genérica num recurso financeiro do Mubisys (contas-pagar, contas-receber…).
async function buscar(recurso, creds, { status, filtrodata, datainicial, datafinal }) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (filtrodata) q.set('filtrodata', filtrodata);
  if (datainicial) q.set('datainicial', datainicial);
  if (datafinal) q.set('datafinal', datafinal);
  const url = `${creds.base}/${creds.publicKey}/${recurso}${q.toString() ? '?' + q : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, {
      headers: { 'Access-Token': creds.accessToken, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, http: r.status, data };
  } finally { clearTimeout(timer); }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Use POST' }, 405);
  const esperado = process.env.TOKEN;
  if (!esperado) return json({ erro: 'TOKEN não configurado no servidor' }, 500);
  if (req.headers.get('x-token') !== esperado) return json({ erro: 'Token inválido' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ erro: 'JSON inválido' }, 400); }
  const { action } = body || {};

  try {
    // ── salvarConfig: grava credenciais vindas da tela de admin ────────────────
    if (action === 'salvarConfig') {
      const s = store('integracoes');
      const atual = (await s.get('mubisys', { type: 'json' }).catch(() => null)) || {};
      const novo = {
        publicKey: (body.publicKey != null ? String(body.publicKey).trim() : atual.publicKey) || '',
        // token vazio = mantém o atual (permite editar só a publicKey)
        accessToken: (body.accessToken ? String(body.accessToken).trim() : atual.accessToken) || '',
        base: (body.base ? String(body.base).trim() : atual.base) || '',
      };
      await s.setJSON('mubisys', novo);
      return json({ ok: true });
    }

    // ── statusConfig: diz se está configurado, sem expor o token ───────────────
    if (action === 'statusConfig') {
      const c = await getCreds();
      const t = c.accessToken || '';
      return json({
        ok: true,
        configurado: !!(c.publicKey && c.accessToken),
        publicKey: c.publicKey,
        base: c.base,
        tokenMascarado: t ? ('•'.repeat(Math.max(0, t.length - 4)) + t.slice(-4)) : '',
      });
    }

    // Demais ações exigem credenciais válidas.
    const creds = await getCreds();
    if (!creds.publicKey || !creds.accessToken)
      return json({ erro: 'Credenciais do Mubisys não cadastradas (Admin → Integração Mubisys).' }, 400);

    const { datainicial, datafinal } = janela(body);

    // ── ping: confere se a credencial responde ────────────────────────────────
    if (action === 'ping') {
      const r = await buscar('contas-pagar', creds, { status: 'PAGO', filtrodata: 'PAGAMENTO', datainicial, datafinal });
      return json({ ok: r.ok, http: r.http });
    }

    // ── preview: amostra CRUA de um recurso (para descobrir os campos reais) ───
    // body.recurso = 'contas-pagar' | 'contas-receber' | 'conta-bancaria' | ...
    if (action === 'preview') {
      const recurso = body.recurso || 'contas-pagar';
      const status = body.status || (recurso.startsWith('conta-banc') ? '' : 'PAGO');
      const filtrodata = body.filtrodata || 'PAGAMENTO';
      const r = await buscar(recurso, creds, { status, filtrodata, datainicial, datafinal });
      if (!r.ok) return json({ erro: `Mubisys HTTP ${r.http}`, detalhe: r.data }, 502);
      const lista = extrairLista(r.data);
      return json({ ok: true, recurso, total: lista.length, campos: lista[0] ? Object.keys(lista[0]) : [], amostra: lista.slice(0, 3) });
    }

    // ── listar: dados de um recurso financeiro (crus; o mapeamento vem depois) ─
    if (action === 'listar') {
      const recurso = body.recurso || 'contas-pagar';
      const status = body.status || (recurso.startsWith('conta-banc') ? '' : 'PAGO');
      const filtrodata = body.filtrodata || 'PAGAMENTO';
      const r = await buscar(recurso, creds, { status, filtrodata, datainicial, datafinal });
      if (!r.ok) return json({ erro: `Mubisys HTTP ${r.http}`, detalhe: r.data }, 502);
      const lista = extrairLista(r.data);
      return json({ ok: true, recurso, total: lista.length, itens: lista });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ erro: String((e && e.message) || e) }, 500);
  }
};
