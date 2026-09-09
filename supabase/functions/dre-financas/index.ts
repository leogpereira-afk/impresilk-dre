// ============================================================================
// dre-financas — conector do ERP (substitui netlify/functions/financas.mjs)
//
// MESMO contrato: salvarConfig | statusConfig | ping | preview | listar |
// importarMes. Coleta paginada, pagamentos por data, deduplicação por título
// e sinalização de lotes parciais. A validação do contrato em produção continua
// necessária antes de promover uma coleta a base conciliada.
//
// De-para: store "integracoes" chave "mubisys" -> dre_meta chave "mubisys";
// fallback pelos secrets MUBI_* (os mesmos do RH/PCP -- a credencial e uma so).
//
// NOVO em relacao ao original: a trava baseConfiavel(). O `base` e cadastravel
// pelo app e o token que autoriza esse cadastro viaja no bundle: sem a trava,
// quem tivesse o token apontava a base para o proprio servidor e recebia a
// credencial do ERP. O Brief ja tinha; o PCP ganhou na migracao; aqui idem.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("DRE_TOKEN") ?? "";
const COLLECTOR_TOKEN = Deno.env.get("DRE_COLLECTOR_TOKEN") ?? "";
const JWT_SECRET = Deno.env.get("EQUIPE_JWT_SECRET") ?? "";

// Cracha da Central de Acessos (ver a explicacao longa em dre-sync): esta
// function fala com o ERP e devolve numero de dinheiro, entao a porta e a
// mesma -- gente entra com cracha, maquina com x-token.
async function lerCracha(token: string): Promise<any | null> {
  if (!JWT_SECRET || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const enc = new TextEncoder();
    const chave = await crypto.subtle.importKey(
      "raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const b64url = (x: string) => {
      x = x.replace(/-/g, "+").replace(/_/g, "/");
      while (x.length % 4) x += "=";
      const bin = atob(x);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const ok = await crypto.subtle.verify(
      "HMAC", chave, b64url(partes[2]), enc.encode(`${partes[0]}.${partes[1]}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64url(partes[1])));
    if (typeof p.exp === "number" && p.exp < Math.floor(Date.now() / 1000)) return null;
    if (p.sis !== "dre") return null;
    return p;
  } catch {
    return null;
  }
}
const DEFAULT_BASE = "https://api.mubisys.com/api";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });

async function getMeta(chave: string): Promise<any | null> {
  const { data, error } = await sb.from("dre_meta").select("valor").eq("chave", chave).maybeSingle();
  if (error) throw new Error("Não foi possível ler a configuração da integração.");
  return data?.valor ?? null;
}
async function setMeta(chave: string, valor: unknown) {
  const { error } = await sb.from("dre_meta").upsert(
    { chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
  if (error) throw new Error("A configuração da integração não foi salva.");
}

function baseConfiavel(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const envBase = String(Deno.env.get("MUBI_BASE_URL") ?? "").trim();
  if (envBase) {
    try { if (new URL(envBase).host === u.host) return true; } catch { /* env torta nao derruba */ }
  }
  const host = u.host.toLowerCase();
  return host === "mubisys.com" || host.endsWith(".mubisys.com");
}

async function getCreds() {
  const cfg = (await getMeta("mubisys")) ?? {};
  const bruta = String(cfg.base || Deno.env.get("MUBI_BASE_URL") || DEFAULT_BASE).replace(/\/+$/, "");
  const base = baseConfiavel(bruta) ? bruta : DEFAULT_BASE;
  if (base !== bruta) console.warn("[dre-financas] base recusada:", bruta);
  return {
    publicKey: cfg.publicKey || Deno.env.get("MUBI_PUBLIC_KEY") || "",
    accessToken: cfg.accessToken || Deno.env.get("MUBI_TOKEN") || "",
    base,
  };
}

const extrairLista = (d: any): any[] =>
  Array.isArray(d) ? d
  : Array.isArray(d?.data) ? d.data
  : Array.isArray(d?.items) ? d.items
  : Array.isArray(d?.results) ? d.results
  : d?.data ? [d.data]
  // Endpoints de item único (contas-receber/{id}, ordem-servico/numero/{n})
  // devolvem o objeto CRU, sem envelope. Sem esta linha eles voltavam vazios.
  : (d && typeof d === "object" && !d.error && Object.keys(d).length) ? [d]
  : [];

function respostaParcial(data: any): boolean {
  return data == null || typeof data !== "object" || (!Array.isArray(data) && !Object.keys(data).length) || !!(data?.error || data?.ok === false || data?.parcial || data?.partial || data?.has_more || data?.next_page || data?.next || data?.links?.next ||
    (Number(data?.total_pages) > Number(data?.current_page || 1)) ||
    (Array.isArray(data?.data) && Number(data?.total) > data.data.length));
}
function vazioConfirmado(recurso: string, r: any): boolean {
  if (!['contas-pagar','contas-receber'].includes(recurso) || r.http !== 404) return false;
  const d=r.data;
  return !respostaParcial(d) && ((Array.isArray(d) && d.length===0) ||
    (['data','items','results'].some(k=>Array.isArray(d?.[k]) && d[k].length===0)));
}

async function buscar(recurso: string, creds: any, f: any, timeoutMs = 22000) {
  const q = new URLSearchParams();
  for (const k of ["status", "filtrodata", "datainicial", "datafinal", "page", "per_page"]) {
    if (f[k]) q.set(k, f[k]);
  }
  const url = `${creds.base}/${creds.publicKey}/${recurso}${q.toString() ? "?" + q : ""}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "Access-Token": creds.accessToken, Accept: "application/json" },
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, http: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// A API documenta page/per_page (até 500) nestas listas. O envelope muda
// entre versões: percorremos páginas numeradas, nunca URLs vindas da resposta.
// Falha, repetição, limite ou total divergente deixam o lote incompleto.
async function buscarCompleto(recurso: string, creds: any, f: any, timeoutMs = 22000, orcamentoMs = 95000) {
  if (!["contas-pagar", "contas-receber", "conta-bancaria"].includes(recurso)) return buscar(recurso, creds, f, timeoutMs);
  const todos: any[] = [], vistos = new Set<string>();
  const inicio = Date.now(), tamanho = 500;
  let totalEsperado: number | null = null, paginas = 0;
  // Apenas códigos fixos, status e contagens: nunca credenciais ou corpo do ERP.
  const resposta = (parcial: boolean, motivo = 'paginacao-inconsistente', http?: number) => ({ok:true,http:200,data:{data:todos,parcial,paginacao:{paginas,totalEsperado},...(parcial ? {diagnostico:{motivo,...(http ? {http} : {})}} : {})}});
  for (let page = 1; page <= 50; page++) {
    const restante = orcamentoMs - (Date.now() - inicio);
    if (restante <= 0) return resposta(true,'orcamento-esgotado');
    let r: any;
    try { r = await buscar(recurso, creds, {...f,page,per_page:tamanho},Math.min(timeoutMs,restante)); }
    catch { return resposta(true,'tempo-ou-rede'); }
    if (vazioConfirmado(recurso,r)) r = {ok:true,http:200,data:[]};
    if (!r.ok) return resposta(true,'http',r.http);
    const d = r.data;
    if (d == null || typeof d !== "object" || d.error || d.ok === false || d.parcial || d.partial) return resposta(true,'resposta-invalida');
    const lote = Array.isArray(d) ? d : [d.data,d.items,d.results].find(Array.isArray);
    if (!lote) return resposta(true,'lista-ausente');
    paginas++;
    const meta = {...(d.pagination || {}),...(d.meta || {}),...d};
    const atual = meta.current_page ?? meta.page;
    if (atual != null && Number(atual) !== page) return resposta(true);
    if (meta.total != null) {
      const t = Number(meta.total);
      if (!Number.isInteger(t) || t < 0 || (totalEsperado != null && t !== totalEsperado)) return resposta(true);
      totalEsperado = t;
    }
    for (const item of lote) {
      const key = item?.id != null ? `${item.empresa_id ?? item.empresa ?? ""}:${item.id}` : JSON.stringify(item);
      if (vistos.has(key)) return resposta(true,'pagina-repetida');
      vistos.add(key);todos.push(item);
    }
    if (totalEsperado != null && todos.length > totalEsperado) return resposta(true);
    const ultima = Number(meta.last_page ?? meta.total_pages ?? 0);
    const proxima = !!(meta.has_more || meta.next_page || meta.next || d.links?.next || ultima > page);
    if (!lote.length) return resposta(proxima || (totalEsperado != null && todos.length !== totalEsperado));
    if (proxima) continue;
    if (totalEsperado != null) {
      if (todos.length === totalEsperado) return resposta(false);
      if (ultima && page >= ultima) return resposta(true);
      continue;
    }
    if (ultima && page >= ultima) return resposta(false);
    if (lote.length < tamanho) return resposta(false);
  }
  return resposta(true,'limite-de-paginas');
}

// Divide [ini, fim] em fatias de N dias: o mes inteiro estoura o tempo do
// Mubisys; semanas voltam rapido e rodam em paralelo.
function fatiar(ini: string, fim: string, dias = 7): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let d = new Date(ini + "T00:00:00Z");
  const end = new Date(fim + "T00:00:00Z");
  while (d <= end) {
    const a = d.toISOString().slice(0, 10);
    const dn = new Date(d);
    dn.setUTCDate(dn.getUTCDate() + dias - 1);
    const b = dn <= end ? dn.toISOString().slice(0, 10) : fim;
    out.push([a, b]);
    dn.setUTCDate(dn.getUTCDate() + 1);
    d = dn;
  }
  return out;
}

// "2.13.5-Juros Cartao" -> { code:'2.13.5', nome:'Juros Cartao' }
function planoCodigo(pc: unknown) {
  const s = String(pc ?? "").trim();
  const m = s.match(/^([\d][\d.]*?)\s*-\s*(.*)$/);
  if (m) return { code: m[1].replace(/\.+$/, ""), nome: (m[2] || "").trim() };
  return { code: "", nome: s };
}

// Valor de CAIXA do titulo dentro da janela: soma os pagamentos que cairam no
// periodo (o topo do titulo as vezes vem com valor_pagamento zerado).
function valorCaixa(t: any, ini: string, fim: string): number {
  const money = (v: any) => { if (v == null || v === "" || !Number.isFinite(Number(v))) throw new Error("Pagamento sem valor válido"); return Math.sign(Number(v)) * Math.round(Math.abs(Number(v)) * 100); };
  const pgs = Array.isArray(t.pagamentos) ? t.pagamentos : [];
  if (pgs.length) {
    let cents = 0;
    for (const p of pgs) {
      const dp = String(p.data_pagamento || p.data_credito || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dp)) throw new Error("Pagamento sem data válida");
      if (dp >= ini && dp <= fim) cents += money(p.valor);
    }
    return cents / 100;
  }
  const dp = String(t.data_pagamento || t.data_credito || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dp)) throw new Error("Título sem data de pagamento válida");
  return dp >= ini && dp <= fim ? money(t.valor_pagamento) / 100 : 0;
}

// O mesmo título pode voltar em várias janelas. A apuração usa sua identidade
// e todos os pagamentos do período, sem depender da ordem das respostas.
function agregarFatias(resultados: any[], ini: string, fim: string) {
  const porCodigo: Record<string, { nome: string; valor: number }> = {};
  let incluidos = 0, ignorados = 0, semCodigo = 0, falhas = 0, duplicados = 0;
  let pagamentosInvalidos = 0, titulosSemId = 0, titulosAlterados = 0;
  const janelasIncompletas: any[] = [];
  let receita = 0, despesa = 0;
  const vistos = new Map<string, string>();
  for (const it of resultados) {
    if (!it?.res?.ok || respostaParcial(it.res.data)) {
      falhas++;
      const d = it?.res?.data?.diagnostico || {};
      janelasIncompletas.push({recurso:it?.rc?.recurso,inicio:it?.a,fim:it?.b,
        motivo:d.motivo || it?.motivo || 'consulta-falhou',...(d.http ? {http:d.http} : {})});
      continue;
    }
    for (const t of extrairLista(it.res.data)) {
      if (t.id == null) { falhas++; titulosSemId++; continue; }
      const key = `${it.rc.recurso}:${t.empresa_id ?? t.empresa ?? ""}:${t.id}`;
      const fingerprint = JSON.stringify([t.compoe_dre, t.plano_contas, t.valor_pagamento, t.data_pagamento, t.pagamentos]);
      if (vistos.has(key)) { duplicados++; if (vistos.get(key) !== fingerprint) { falhas++; titulosAlterados++; } continue; }
      vistos.set(key, fingerprint);
      if (String(t.compoe_dre ?? "").toLowerCase() !== "sim") { ignorados++; continue; }
      let cents: number;
      try { cents = Math.round(valorCaixa(t, ini, fim) * 100); } catch { falhas++; pagamentosInvalidos++; continue; }
      if (it.rc.recurso === "contas-receber") receita += cents; else despesa += cents;
      incluidos++;
      const { code, nome } = planoCodigo(t.plano_contas);
      if (!code) { semCodigo++; continue; }
      if (!porCodigo[code]) porCodigo[code] = { nome, valor: 0 };
      porCodigo[code].valor += cents;
    }
  }
  for (const k in porCodigo) porCodigo[k].valor /= 100;
  return {porCodigo, totais:{receita:receita / 100, despesa:despesa / 100},
    diag:{incluidos,ignorados,semCodigo,falhas,duplicados,janelasIncompletas,pagamentosInvalidos,titulosSemId,titulosAlterados}, parcial:falhas > 0};
}

function explicarConsulta(diag: any): string {
  const motivos: Record<string,string> = {'tempo-ou-rede':'tempo de resposta ou rede','orcamento-esgotado':'tempo total esgotado',
    'pagina-repetida':'página repetida','paginacao-inconsistente':'paginação inconsistente','resposta-invalida':'resposta inválida',
    'lista-ausente':'lista não encontrada','limite-de-paginas':'limite de páginas','consulta-falhou':'consulta falhou'};
  const partes = diag.janelasIncompletas.map((j: any) => `${j.recurso} (${j.inicio} a ${j.fim}): ${j.motivo === 'http' ? 'HTTP '+j.http : motivos[j.motivo] || 'consulta incompleta'}`);
  if (diag.pagamentosInvalidos) partes.push(`${diag.pagamentosInvalidos} pagamentos sem data ou valor válido`);
  if (diag.titulosSemId) partes.push(`${diag.titulosSemId} títulos sem identificação`);
  if (diag.titulosAlterados) partes.push(`${diag.titulosAlterados} títulos alterados durante a consulta`);
  return 'Consulta incompleta. Nenhum total será usado para confronto. '+partes.join('; ')+'.';
}


/* ---------------------------------------------------------------- revogacao
   "Esse cracha ainda vale?" -- a pergunta que ESTA porta nao fazia.
   O cracha e um JWT de 30 dias (12h no Painel) guardado no aparelho: assinatura,
   validade e sistema conferiam, e mais nada. Desativar alguem na tela de Acessos
   nao fechava porta nenhuma deste lado ate o cracha vencer.

   A regra mora no BANCO (public.acesso_revogado), e nao num arquivo aqui: as
   portas de dados estao em CINCO repositorios e cada function empacota o proprio
   codigo -- um _shared/revogacao.ts viraria doze copias envelhecendo caladas,
   que e a doenca que esta semana perseguiu. O banco os oito ja dividem.

   Cache de 60s por pessoa: uma consulta por minuto, nao por request.
   Banco fora do ar ACEITA e nao guarda no cache -- trancar a casa inteira por
   causa de uma consulta que falhou e pior do que um cracha durar mais um pouco. */
const CACHE_REVOG = new Map<string, { ate: number; revogado: boolean }>();
async function crachaRevogado(sb: any, sistema: string, cracha: any): Promise<boolean> {
  const sub = String(cracha?.sub ?? "").trim();
  if (!sub) return false;
  const papel = String(cracha?.papel ?? "");
  const chave = `${sistema}:${papel}:${sub}`;
  const agora = Date.now();
  const emCache = CACHE_REVOG.get(chave);
  if (emCache && emCache.ate > agora) return emCache.revogado;
  try {
    const { data, error } = await sb.rpc("acesso_revogado", {
      p_sistema: sistema, p_sub: sub, p_papel: papel,
    });
    if (error) throw new Error(error.message);
    const revogado = data === true;
    CACHE_REVOG.set(chave, { ate: agora + 60_000, revogado });
    return revogado;
  } catch (e) {
    console.error("[revogacao] indisponivel:", (e as Error)?.message);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  const m = String(req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const cracha = m ? await lerCracha(m[1]) : null;
  if (cracha && await crachaRevogado(sb, "dre", cracha)) {
    return json({ erro: "Seu acesso ao sistema foi encerrado. Fale com a gestão.", semSessao: true }, 401);
  }
  const ehMaquina = !!TOKEN && req.headers.get("x-token") === TOKEN;
  const ehColetor = !!COLLECTOR_TOKEN && req.headers.get("x-token") === COLLECTOR_TOKEN;
  if (!cracha && !ehMaquina && !ehColetor) return json({ erro: "Entre no sistema.", semSessao: true }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }
  const action = body?.action as string;
  if (ehColetor && (!['ping','raw','listar','importarMes'].includes(action) ||
      (body.recurso && !['contas-pagar','contas-receber','conta-bancaria'].includes(body.recurso) && !/^ordem-servico\/numero\/\d+$/.test(body.recurso))))
    return json({erro:'A credencial da coleta não permite esta ação ou recurso.'},403);

  try {
    if (action === "salvarConfig") {
      if (!ehMaquina) {
        const {data,error} = await sb.from("dre_config_global").select("config").eq("id",true).maybeSingle();
        if (error) return json({erro:"Não foi possível conferir permissões."},503);
        const papel = data?.config?.permissoes?.[String(cracha.sub)] ||
          (["admin","master","direcao"].includes(String(cracha.papel)) ? "admin" : "edicao");
        if (papel !== "admin") return json({erro:"A configuração da integração exige acesso administrativo."},403);
      }
      const atual = (await getMeta("mubisys")) ?? {};
      if (body.base && String(body.base).trim() && !baseConfiavel(String(body.base).trim().replace(/\/+$/, ""))) {
        return json({ erro: "Endereço do Mubisys não permitido. Use o endereço oficial (…mubisys.com)." }, 400);
      }
      await setMeta("mubisys", {
        publicKey: (body.publicKey != null ? String(body.publicKey).trim() : atual.publicKey) || "",
        // token vazio = mantem o atual (permite editar so a publicKey)
        accessToken: (body.accessToken ? String(body.accessToken).trim() : atual.accessToken) || "",
        base: (body.base ? String(body.base).trim() : atual.base) || "",
      });
      return json({ ok: true });
    }

    if (action === "statusConfig") {
      const c = await getCreds();
      const t = c.accessToken || "";
      return json({
        ok: true,
        configurado: !!(c.publicKey && c.accessToken),
        publicKey: c.publicKey,
        base: c.base,
        tokenMascarado: t ? "•".repeat(Math.max(0, t.length - 4)) + t.slice(-4) : "",
      });
    }

    const creds = await getCreds();
    if (!creds.publicKey || !creds.accessToken) {
      return json({ erro: "Credenciais do Mubisys não cadastradas (Admin → Integração Mubisys)." }, 400);
    }
    const datainicial = body.datainicial || "";
    const datafinal = body.datafinal || "";

    // Uma resposta HTTP prova comunicação, não comprova autenticação nem
    // ausência de lançamentos. O sucesso exige consulta válida com lista.
    if (action === "ping") {
      const r = await buscar("contas-pagar", creds, { status:"PAGO", filtrodata:"PAGAMENTO", datainicial, datafinal, page:1, per_page:1 });
      const d = r.data;
      const lista = Array.isArray(d) ? d : [d?.data,d?.items,d?.results].find(Array.isArray);
      const vazio = vazioConfirmado("contas-pagar",r);
      const valido = (r.ok && !!lista && !d?.error && d?.ok !== false) || vazio;
      return json({ok:valido,http:r.http,vazio,
        detalhe:valido ? "Consulta ao Mubisys validada. A conferência do período exige a coleta completa."
          : r.http === 422 ? "O servidor respondeu, mas recusou os parâmetros da consulta."
          : "O servidor respondeu sem comprovar uma consulta válida. Confira o período e a integração.",
      });
    }

    // Diagnóstico limitado à estrutura: não devolve amostras nem valores.
    if (action === "raw") {
      const recurso = body.recurso || "contas-pagar";
      if (!['contas-pagar','contas-receber','conta-bancaria'].includes(recurso) && !/^ordem-servico\/numero\/\d+$/.test(recurso)) return json({erro:'Recurso de diagnóstico não permitido.'},400);
      const r = await buscar(recurso, creds, {
        status: body.status ?? "",
        filtrodata: body.filtrodata ?? "",
        datainicial, datafinal, page:body.page, per_page:body.per_page,
      });
      const lista = r.ok ? extrairLista(r.data) : [];
      const tipos: Record<string,string> = {};
      for (const item of lista.slice(0,3)) for (const [campo,valor] of Object.entries(item)) {
        tipos[campo] = Array.isArray(valor) ? 'array' : valor === null ? 'null' : typeof valor;
      }
      return json({ok:r.ok,http:r.http,total:lista.length,campos:Object.keys(tipos),tipos});
    }

    if (action === "preview" || action === "listar") {
      const recurso = body.recurso || "contas-pagar";
      const status = body.status || (recurso.startsWith("conta-banc") ? "" : "PAGO");
      const filtrodata = body.filtrodata || "PAGAMENTO";
      const r = await buscarCompleto(recurso, creds, { status, filtrodata, datainicial, datafinal });
      // HTTP 404 sozinho não comprova ausência de lançamentos. Exige envelope
      // vazio verificável; outros formatos precisam da validação do contrato.
      if (vazioConfirmado(recurso, r)) {
        return json(action === "preview"
          ? { ok: true, recurso, total: 0, vazio: true, campos: [], amostra: [] }
          : { ok: true, recurso, total: 0, vazio: true, itens: [] });
      }
      if (!r.ok) return json({ erro: `Mubisys HTTP ${r.http}`, detalhe: r.data }, 502);
      let lista = extrairLista(r.data);
      if (/^ordem-servico\/numero\/\d+$/.test(recurso)) {
        // O rateio precisa apenas de status, produto/modelo e pesos dos itens.
        const item = (i: any): any => ({item:i.item,modelo:i.modelo,valor_final:i.valor_final,sub_total:i.sub_total,
          itens_agrupados:Array.isArray(i.itens_agrupados) ? i.itens_agrupados.map(item) : []});
        lista = lista.map(o=>({id:o.id,status:o.status,itens:Array.isArray(o.itens) ? o.itens.map(item) : []}));
      }
      if (action === "preview") {
        return json({ ok: true, recurso, total: lista.length, parcial:respostaParcial(r.data),
          campos: lista[0] ? Object.keys(lista[0]) : [], amostra: lista.slice(0, 3) });
      }
      return json({ ok: true, recurso, total: lista.length, parcial:respostaParcial(r.data),
        ...(r.data?.diagnostico ? {diagnostico:r.data.diagnostico} : {}), itens: lista });
    }

    if (action === "importarMes") {
      if (!datainicial || !datafinal) return json({ erro: "datainicial/datafinal obrigatórios" }, 400);
      const fatias = fatiar(datainicial, datafinal, 7);
      const recursos = [
        { recurso: "contas-pagar", status: "PAGO", filtrodata: "PAGAMENTO" },
        { recurso: "contas-receber", status: "PAGO", filtrodata: "PAGAMENTO" },
      ];
      // Duas consultas simultâneas, repetição limitada e orçamento de execução.
      type Fatia = { rc: any; a: string; b: string };
      const todas: Fatia[] = [];
      for (const rc of recursos) for (const [a, b] of fatias) todas.push({ rc, a, b });

      const inicioImport = Date.now();
      const ORCAMENTO_MS = 120000;
      let retentadas = 0;

      const umaFatia = async (f: Fatia) => {
        for (let tentativa = 1; tentativa <= 2; tentativa++) {
          if (Date.now() - inicioImport >= ORCAMENTO_MS) return { ...f, res: null, motivo:'orcamento-esgotado' };
          try {
            const res = await buscarCompleto(f.rc.recurso, creds, {
              status: f.rc.status, filtrodata: f.rc.filtrodata,
              datainicial: f.a, datafinal: f.b,
            }, 45000, Math.max(1,ORCAMENTO_MS-(Date.now()-inicioImport)));
            if (res.ok) return { ...f, res };
            if (vazioConfirmado(f.rc.recurso,res)) return {...f,res:{ok:true,data:[]}};
          } catch { /* tenta de novo */ }
          if (tentativa === 1) retentadas++;
        }
        return { ...f, res: null };
      };

      const resultados: any[] = [];
      const fila = [...todas];
      await Promise.all([1, 2].map(async () => {
        while (fila.length) {
          const f = fila.shift()!;
          resultados.push(await umaFatia(f));
        }
      }));
      const apuracao = agregarFatias(resultados, datainicial, datafinal);
      return json({ok:true, ...apuracao,
        diag:{...apuracao.diag, fatias:fatias.length, retentadas},
        ...(apuracao.parcial ? {aviso:explicarConsulta(apuracao.diag)} : {}),
      });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ erro: (e as Error)?.message ?? String(e) }, 500);
  }
});
