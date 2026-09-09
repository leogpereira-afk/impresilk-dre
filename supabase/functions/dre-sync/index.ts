// ============================================================================
// dre-sync — Edge Function do DRE Caixa (substitui netlify/functions/os.mjs)
//
// MESMO contrato: ping | list | upsert | delete | getCfg | setCfg |
// putPhoto | getPhoto.
//
// ATENCAO AO FORMATO DO list: este app pagina por OFFSET e devolve o campo
// "itens" -- diferente do Brief/PCP, que paginam por chave e devolvem "os".
// O painel-backup puxa o DRE com listKey "os" e fallback "itens", entao o
// formato preservado tambem mantem o backup do Hub funcionando.
//
// PROJETO COMPARTILHADO: prefixo obrigatorio no nome da function.
//
// AUTORIZACAO (mudou em 05/08/2026, e a mudanca importa):
//
// Ate aqui a unica porta era o x-token -- e esse token estava ESCRITO EM TEXTO
// PURO no config.js, que e servido ao navegador. Qualquer pessoa que abrisse o
// codigo-fonte da pagina baixava o DRE inteiro (receita, custo, resultado mes a
// mes) sem login nenhum. Foi confirmado na pratica: 284 KB baixados so com o
// que estava no arquivo publico. O proprio comentario de la admitia "NAO e
// seguranca forte".
//
// Agora sao DUAS portas, para dois usos que sempre foram diferentes:
//
//   GENTE   -> Authorization: Bearer <cracha da equipe-auth>, com sis = "dre".
//              E o mesmo cracha que ja abre a tela; agora ele tambem abre o
//              dado. O segredo (EQUIPE_JWT_SECRET) nunca sai do servidor.
//   MAQUINA -> x-token, so para o backup do Hub, que nao tem como fazer login.
//              O valor FOI GIRADO: o antigo e publico para sempre.
//
// Se um dia o x-token voltar a aparecer em arquivo de cliente, o buraco volta.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("DRE_TOKEN") ?? "";
const JWT_SECRET = Deno.env.get("EQUIPE_JWT_SECRET") ?? "";
const BUCKET = "dre-arquivos";

// Le o cracha da Central de Acessos. Copia enxuta do verificarJwt da
// equipe-auth: so Web Crypto, sem dependencia.
async function lerCracha(token: string): Promise<any | null> {
  if (!JWT_SECRET || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const enc = new TextEncoder();
    const chave = await crypto.subtle.importKey(
      "raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const b64url = (s: string) => {
      s = s.replace(/-/g, "+").replace(/_/g, "/");
      while (s.length % 4) s += "=";
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };
    const ok = await crypto.subtle.verify(
      "HMAC", chave, b64url(partes[2]), enc.encode(`${partes[0]}.${partes[1]}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64url(partes[1])));
    if (typeof p.exp === "number" && p.exp < Math.floor(Date.now() / 1000)) return null;
    // O cracha e emitido POR SISTEMA. Um cracha do Brief nao abre o DRE --
    // era exatamente esse o furo da acao "eu" da equipe-auth.
    if (p.sis !== "dre") return null;
    return p;
  } catch {
    return null;
  }
}

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

async function getReg(id: string): Promise<any | null> {
  const { data, error } = await sb.from("dre_registros").select("registro,atualizado_em")
    .eq("colecao", "os").eq("id", id).maybeSingle();
  if (error) throw new Error("Falha ao conferir a versão do registro.");
  return data ?? null;
}

const b64ParaBytes = (b64: string) =>
  Uint8Array.from(atob(b64.includes(",") ? b64.split(",")[1] : b64), (c) => c.charCodeAt(0));
function bytesParaB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const BLOCO = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCO) s += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  return btoa(s);
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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  // Gente entra com cracha; maquina (o backup do Hub) entra com x-token.
  const m = String(req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const cracha = m ? await lerCracha(m[1]) : null;
  if (cracha && await crachaRevogado(sb, "dre", cracha)) {
    return json({ erro: "Seu acesso ao sistema foi encerrado. Fale com a gestão.", semSessao: true }, 401);
  }
  const token = req.headers.get("x-token") ?? body.token;
  const ehMaquina = !!TOKEN && token === TOKEN;
  if (!cracha && !ehMaquina) {
    return json({ erro: "Entre no sistema.", semSessao: true }, 401);
  }

  try {
    let papel = ehMaquina ? "admin" : "edicao";
    if (!ehMaquina) {
      const {data,error}=await sb.from("dre_config_global").select("config").eq("id",true).maybeSingle();
      if(error) return json({erro:"Não foi possível conferir permissões."},503);
      papel = data?.config?.permissoes?.[String(cracha.sub)] ||
        (["admin","master","direcao"].includes(String(cracha.papel)) ? "admin" : "edicao");
    }
    const permissoes={leitura:true,edicao:["edicao","admin"].includes(papel),admin:papel==="admin"};
    if(body.action === "permissions") return json({ok:true,permissoes});
    if(["upsert","putPhoto"].includes(body.action) && !permissoes.edicao) return json({erro:"Sem permissão de edição."},403);
    if(["setCfg","delete"].includes(body.action) && !permissoes.admin) return json({erro:"Ação administrativa restrita."},403);
    switch (body.action as string) {
      case "ping":
        return json({ ok: true, ts: new Date().toISOString() });

      // Pagina por OFFSET e devolve "itens" -- o formato deste app.
      case "list": {
        const PAGE = 150;
        const offset = Math.max(0, parseInt(body.offset, 10) || 0);
        const { data, error, count } = await sb.from("dre_registros")
          .select("registro", { count: "exact" })
          .eq("colecao", "os").order("id").range(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        const total = count ?? 0;
        return json({
          ok: true,
          itens: (data ?? []).map((r: any) => r.registro),
          total,
          nextOffset: offset + PAGE < total ? offset + PAGE : null,
        });
      }

      // Comparação atômica de versão: o relógio do cliente não decide quem ganha.
      case "upsert": {
        const reg = body.registro;
        if (!reg || !/^[A-Za-z0-9_/-]{1,80}$/.test(String(reg.id || "")) ||
            !/^[A-Za-zçÇ]{3}\w*\/\d{4}$/.test(String(reg.label || "")) ||
            !Array.isArray(reg.cells) || reg.cells.length > 10000) return json({erro:"Registro mensal inválido."},400);
        const codes = new Set<string>();
        for (const c of reg.cells) {
          if (!/^\d+(\.\d+)*$/.test(String(c.code)) || codes.has(c.code) || typeof c.value !== "number" || !Number.isFinite(c.value))
            return json({erro:"Conta duplicada ou valor inválido."},400);
          codes.add(c.code);
        }
        if (!codes.has("1") || !codes.has("2")) return json({erro:"Totais 1 e 2 obrigatórios."},400);
        const id = String(reg.id), atual = await getReg(id);
        const op = String(body.operacaoId || "").slice(0,160);
        if (op && atual?.registro?._operacaoId === op) return json({ok:true,registro:atual.registro});
        const base = body.baseAtualizadoEm;
        if (atual && (!base || new Date(base).getTime() !== new Date(atual.registro.atualizadoEm).getTime()))
          return json({conflito:true,servidor:atual.registro},409);
        if (!atual && base) return json({conflito:true,servidor:null},409);
        const salvo = {...reg,id,atualizadoEm:new Date().toISOString(),_operacaoId:op,
          alteradoPor:ehMaquina?"coletor":String(cracha.sub),baseAtualizadoEm:undefined};
        const linha = {colecao:"os",id,registro:salvo,atualizado_em:salvo.atualizadoEm};
        const res = atual
          ? await sb.from("dre_registros").update(linha).eq("colecao","os").eq("id",id).eq("atualizado_em",atual.atualizado_em).select("registro")
          : await sb.from("dre_registros").insert(linha).select("registro");
        if (res.error?.code === "23505" || (!res.error && !res.data?.length)) {
          const novo = await getReg(id); return json({conflito:true,servidor:novo?.registro||null},409);
        }
        if (res.error) throw new Error("Gravação não concluída.");
        return json({ok:true,registro:salvo});
      }

      case "delete": {
        const id = String(body.id ?? "");
        if (!id) return json({ erro: "id obrigatório" }, 400);
        const { error } = await sb.from("dre_registros").delete().eq("colecao", "os").eq("id", id);
        if (error) throw new Error("Exclusão não concluída.");
        return json({ ok: true });
      }

      case "getCfg": {
        const { data, error } = await sb.from("dre_config_global").select("config,atualizado_em").eq("id", true).maybeSingle();
        if (error) throw new Error("Configuração não pôde ser lida.");
        const cfg = {...(data?.config || {})}; if (!permissoes.admin) delete cfg.permissoes;
        return json({ ok: true, cfg, atualizadoEm:data?.atualizado_em||null });
      }

      case "setCfg": {
        const {data:atual,error:readError}=await sb.from("dre_config_global").select("config,atualizado_em").eq("id",true).maybeSingle();
        if(readError) throw new Error("Configuração indisponível.");
        if(atual && body.baseAtualizadoEm !== atual.atualizado_em) return json({conflito:true},409);
        const linha={id:true,config:body.cfg||{},atualizado_em:new Date().toISOString()};
        const r=atual?await sb.from("dre_config_global").update(linha).eq("id",true).eq("atualizado_em",atual.atualizado_em).select("id")
          :await sb.from("dre_config_global").insert(linha).select("id");
        if(r.error?.code === "23505" || (!r.error && !r.data?.length)) return json({conflito:true},409);
        if(r.error) throw new Error("Configuração não salva.");
        return json({ok:true,atualizadoEm:linha.atualizado_em});
      }

      case "putPhoto": {
        const { base64, mime, fileId } = body;
        if (!base64) return json({ erro: "base64 ausente" }, 400);
        const id = fileId || "foto_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        const { error } = await sb.storage.from(BUCKET).upload(id, b64ParaBytes(base64), {
          contentType: mime || "image/jpeg", upsert: true });
        if (error) throw new Error("upload: " + error.message);
        return json({ ok: true, fileId: id });
      }

      case "getPhoto": {
        const fileId = String(body.fileId ?? "");
        if (!fileId) return json({ erro: "fileId ausente" }, 400);
        const { data, error } = await sb.storage.from(BUCKET).download(fileId);
        if (error || !data) return json({ erro: "Foto não encontrada" }, 404);
        return json({ ok: true, base64: bytesParaB64(await data.arrayBuffer()), mime: data.type || "image/jpeg" });
      }

      default:
        return json({ erro: `Ação desconhecida: ${body.action}` }, 400);
    }
  } catch (e) {
    console.error("[dre-sync] erro:", e);
    return json({ erro: (e as Error)?.message ?? "Erro interno" }, 500);
  }
});
