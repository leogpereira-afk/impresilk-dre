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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  if (!TOKEN) return json({ erro: "DRE_TOKEN não configurado no servidor" }, 500);
  if (req.headers.get("x-token") !== TOKEN) return json({ erro: "Token inválido" }, 401);

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

    if (action === "ping") {
      const r = await buscar("contas-pagar", creds, { status: "PAGO", filtrodata: "PAGAMENTO", datainicial, datafinal });
      return json({ ok: r.ok, http: r.http });
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
