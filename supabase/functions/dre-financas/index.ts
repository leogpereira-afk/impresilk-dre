// ============================================================================
// dre-financas — conector do ERP (substitui netlify/functions/financas.mjs)
//
// MESMO contrato: salvarConfig | statusConfig | ping | preview | listar |
// importarMes. O importarMes puxa o mes em fatias semanais paralelas, filtra
// compoe_dre=Sim e soma o valor de CAIXA por codigo do plano de contas -- e o
// coracao do DRE, portado sem mudar a matematica.
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
  const { data } = await sb.from("dre_meta").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}
async function setMeta(chave: string, valor: unknown) {
  await sb.from("dre_meta").upsert(
    { chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: "chave" });
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

async function buscar(recurso: string, creds: any, f: any, timeoutMs = 22000) {
  const q = new URLSearchParams();
  for (const k of ["status", "filtrodata", "datainicial", "datafinal"]) {
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
  const pgs = Array.isArray(t.pagamentos) ? t.pagamentos : [];
  if (pgs.length) {
    let s = 0;
    for (const p of pgs) {
      const dp = String(p.data_pagamento || p.data_credito || "").slice(0, 10);
      if (dp >= ini && dp <= fim) s += Number(p.valor) || 0;
    }
    if (s) return s;
  }
  return Number(t.valor_pagamento) || Number(t.valor_titulo) || 0;
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
  if (!cracha && !ehMaquina) return json({ erro: "Entre no sistema.", semSessao: true }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }
  const action = body?.action as string;

  try {
    if (action === "salvarConfig") {
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

    // PING responde "a integração está viva?", não "esse período tem dado?".
    // O Mubisys devolve 404 para janela sem lançamento e 422 quando falta a
    // data — nos dois casos ele FALOU CONOSCO e aceitou a credencial, então a
    // conexão está boa. Antes o ping devolvia ok:false nesses dois casos e o
    // teste acusava queda num domingo sem pagamento.
    if (action === "ping") {
      const r = await buscar("contas-pagar", creds, { status: "PAGO", filtrodata: "PAGAMENTO", datainicial, datafinal });
      const vivo = r.ok || r.http === 404 || r.http === 422;
      return json({
        ok: vivo,
        http: r.http,
        vazio: !r.ok && r.http === 404,
        detalhe: r.ok ? "conexão e credencial OK"
          : r.http === 404 ? "conexão OK — período sem lançamento"
          : r.http === 422 ? "conexão OK — faltou informar o período"
          : "o Mubisys recusou a chamada",
      });
    }

    // Diagnóstico: devolve a resposta do Mubisys EXATAMENTE como veio, sem
    // extrair lista. Serve para mapear endpoint novo antes de escrever código.
    if (action === "raw") {
      const recurso = body.recurso || "contas-pagar";
      const r = await buscar(recurso, creds, {
        status: body.status ?? "",
        filtrodata: body.filtrodata ?? "",
        datainicial, datafinal,
      });
      return json({ ok: r.ok, http: r.http, resposta: r.data });
    }

    if (action === "preview" || action === "listar") {
      const recurso = body.recurso || "contas-pagar";
      const status = body.status || (recurso.startsWith("conta-banc") ? "" : "PAGO");
      const filtrodata = body.filtrodata || "PAGAMENTO";
      const r = await buscar(recurso, creds, { status, filtrodata, datainicial, datafinal });
      // 404 do Mubisys é AUSÊNCIA DE DADO, não falha: devolve lista vazia em vez
      // de 502. Como estava, um período sem lançamento chegava no painel como
      // erro de servidor (o robô já contornava isso por conta própria).
      if (!r.ok && r.http === 404) {
        return json(action === "preview"
          ? { ok: true, recurso, total: 0, vazio: true, campos: [], amostra: [] }
          : { ok: true, recurso, total: 0, vazio: true, itens: [] });
      }
      if (!r.ok) return json({ erro: `Mubisys HTTP ${r.http}`, detalhe: r.data }, 502);
      const lista = extrairLista(r.data);
      if (action === "preview") {
        return json({ ok: true, recurso, total: lista.length,
          campos: lista[0] ? Object.keys(lista[0]) : [], amostra: lista.slice(0, 3) });
      }
      return json({ ok: true, recurso, total: lista.length, itens: lista });
    }

    if (action === "importarMes") {
      if (!datainicial || !datafinal) return json({ erro: "datainicial/datafinal obrigatórios" }, 400);
      const fatias = fatiar(datainicial, datafinal, 7);
      const recursos = [
        { recurso: "contas-pagar", status: "PAGO", filtrodata: "PAGAMENTO" },
        { recurso: "contas-receber", status: "PAGO", filtrodata: "PAGAMENTO" },
      ];
      // FILA DE 2, nao rajada de 10. A conferencia da migracao pegou que o
      // importarMes sempre foi loteria: o mesmo junho deu 86k, 221k e 428k em
      // tres rodadas. Causa raiz: o Mubisys engasga com rajada -- a medicao do
      // Painel (lib/mubi.js) mostra que 2 chamadas simultaneas respondem bem e
      // 4+ estouram TODAS. O codigo original disparava as 10 fatias de uma vez
      // e depois descartava em silencio as que ele mesmo afogou.
      //
      // Fila de 2 + uma nova tentativa por fatia + orcamento global de 120s
      // (a Edge Function morre em 150). Se mesmo assim sobrar fatia, o
      // resultado sai marcado como parcial -- numero incompleto SEM aviso e um
      // numero errado com cara de certo.
      type Fatia = { rc: any; a: string; b: string };
      const todas: Fatia[] = [];
      for (const rc of recursos) for (const [a, b] of fatias) todas.push({ rc, a, b });

      const inicioImport = Date.now();
      const ORCAMENTO_MS = 120000;
      let retentadas = 0;

      const umaFatia = async (f: Fatia) => {
        for (let tentativa = 1; tentativa <= 2; tentativa++) {
          if (Date.now() - inicioImport > ORCAMENTO_MS) return { ...f, res: null };
          try {
            const res = await buscar(f.rc.recurso, creds, {
              status: f.rc.status, filtrodata: f.rc.filtrodata,
              datainicial: f.a, datafinal: f.b,
            }, 45000);
            if (res.ok) return { ...f, res };
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
      const porCodigo: Record<string, { nome: string; valor: number }> = {};
      let incluidos = 0, ignorados = 0, semCodigo = 0, falhas = 0;
      for (const it of resultados) {
        if (!it?.res?.ok) { falhas++; continue; }
        for (const t of extrairLista(it.res.data)) {
          if (String(t.compoe_dre ?? "").toLowerCase() !== "sim") { ignorados++; continue; }
          const { code, nome } = planoCodigo(t.plano_contas);
          if (!code) { semCodigo++; continue; }
          const v = valorCaixa(t, it.a, it.b);
          if (!porCodigo[code]) porCodigo[code] = { nome, valor: 0 };
          porCodigo[code].valor += v;
          incluidos++;
        }
      }
      for (const k in porCodigo) porCodigo[k].valor = Math.round(porCodigo[k].valor * 100) / 100;
      const somaGrupo = (pref: string) => Math.round(
        Object.entries(porCodigo)
          .filter(([c]) => c === pref || c.startsWith(pref + "."))
          .reduce((s, [, v]) => s + v.valor, 0) * 100) / 100;
      // parcial: true quando mesmo a segunda passada perdeu fatia. Um total
      // parcial SEM aviso e um numero errado com cara de certo -- foi assim que
      // a auditoria apontava divergencias falsas.
      const parcial = falhas > 0;
      return json({
        ok: true, porCodigo,
        totais: { receita: somaGrupo("1"), despesa: somaGrupo("2") },
        diag: { incluidos, ignorados, semCodigo, falhas, fatias: fatias.length, retentadas },
        parcial,
        ...(parcial ? { aviso: `${falhas} fatia(s) do periodo falharam mesmo apos nova tentativa -- os totais estao INCOMPLETOS. Tente de novo.` } : {}),
      });
    }

    return json({ erro: `Ação desconhecida: ${action}` }, 400);
  } catch (e) {
    return json({ erro: (e as Error)?.message ?? String(e) }, 500);
  }
});
