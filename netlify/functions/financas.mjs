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
async function buscar(recurso, creds, { status, filtrodata, datainicial, datafinal }, timeoutMs = 22000) {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (filtrodata) q.set('filtrodata', filtrodata);
  if (datainicial) q.set('datainicial', datainicial);
  if (datafinal) q.set('datafinal', datafinal);
  const url = `${creds.base}/${creds.publicKey}/${recurso}${q.toString() ? '?' + q : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'Access-Token': creds.accessToken, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, http: r.status, data };
  } finally { clearTimeout(timer); }
}

// Divide [ini, fim] (AAAA-MM-DD) em fatias de N dias — o mês inteiro estoura o
// tempo do Mubisys; semanas voltam rápido e rodam em paralelo.
function fatiar(ini, fim, dias = 7) {
  const out = [];
  let d = new Date(ini + 'T00:00:00Z');
  const end = new Date(fim + 'T00:00:00Z');
  while (d <= end) {
    const a = d.toISOString().slice(0, 10);
    const dn = new Date(d); dn.setUTCDate(dn.getUTCDate() + dias - 1);
    const b = dn <= end ? dn.toISOString().slice(0, 10) : fim;
    out.push([a, b]);
    dn.setUTCDate(dn.getUTCDate() + 1);
    d = dn;
  }
  return out;
}

// "2.13.5-Juros Cartão" → { code:'2.13.5', nome:'Juros Cartão' }
function planoCodigo(pc) {
  const s = String(pc || '').trim();
  const m = s.match(/^([\d][\d.]*?)\s*-\s*(.*)$/);
  if (m) return { code: m[1].replace(/\.+$/, ''), nome: (m[2] || '').trim() };
  return { code: '', nome: s };
}

// Valor de CAIXA do título dentro da janela: soma os pagamentos cujo pagamento
// caiu no período (o topo do título às vezes vem com valor_pagamento zerado).
function valorCaixa(t, ini, fim) {
  const pgs = Array.isArray(t.pagamentos) ? t.pagamentos : [];
  if (pgs.length) {
    let s = 0;
    for (const p of pgs) {
      const dp = String(p.data_pagamento || p.data_credito || '').slice(0, 10);
      if (dp >= ini && dp <= fim) s += Number(p.valor) || 0;
    }
    if (s) return s;
  }
  return Number(t.valor_pagamento) || Number(t.valor_titulo) || 0;
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

    // ── importarMes: agrega contas-pagar + contas-receber por plano de contas ──
    // Puxa o mês em fatias semanais (paralelas), filtra compoe_dre=Sim e soma o
    // valor de caixa por código de conta. Devolve o mapa {codigo:{nome,valor}}
    // + totais, no formato que o painel usa para montar o mês da DRE.
    if (action === 'importarMes') {
      if (!datainicial || !datafinal) return json({ erro: 'datainicial/datafinal obrigatórios' }, 400);
      const fatias = fatiar(datainicial, datafinal, 7);
      const recursos = [
        { recurso: 'contas-pagar',   status: 'PAGO', filtrodata: 'PAGAMENTO' },
        { recurso: 'contas-receber', status: 'PAGO', filtrodata: 'PAGAMENTO' },
      ];
      const tarefas = [];
      for (const rc of recursos) for (const [a, b] of fatias) {
        tarefas.push(
          buscar(rc.recurso, creds, { status: rc.status, filtrodata: rc.filtrodata, datainicial: a, datafinal: b }, 20000)
            .then(res => ({ a, b, res })).catch(() => null)
        );
      }
      const resultados = await Promise.all(tarefas);
      const porCodigo = {};
      let incluidos = 0, ignorados = 0, semCodigo = 0, falhas = 0;
      for (const it of resultados) {
        if (!it || !it.res || !it.res.ok) { falhas++; continue; }
        for (const t of extrairLista(it.res.data)) {
          if (String(t.compoe_dre || '').toLowerCase() !== 'sim') { ignorados++; continue; }
          const { code, nome } = planoCodigo(t.plano_contas);
          if (!code) { semCodigo++; continue; }
          const v = valorCaixa(t, it.a, it.b);
          if (!porCodigo[code]) porCodigo[code] = { nome, valor: 0 };
          porCodigo[code].valor += v;
          incluidos++;
        }
      }
      for (const k in porCodigo) porCodigo[k].valor = Math.round(porCodigo[k].valor * 100) / 100;
      const somaGrupo = pref => Math.round(
        Object.entries(porCodigo)
          .filter(([c]) => c === pref || c.startsWith(pref + '.'))
          .reduce((s, [, v]) => s + v.valor, 0) * 100) / 100;
      return json({
        ok: true, porCodigo,
        totais: { receita: somaGrupo('1'), despesa: somaGrupo('2') },
        diag: { incluidos, ignorados, semCodigo, falhas, fatias: fatias.length }
      });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ erro: String((e && e.message) || e) }, 500);
  }
};
