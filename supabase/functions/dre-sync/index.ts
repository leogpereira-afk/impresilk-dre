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
  const { data } = await sb.from("dre_registros").select("registro")
    .eq("colecao", "os").eq("id", id).maybeSingle();
  return data?.registro ?? null;
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
  const token = req.headers.get("x-token") ?? body.token;
  const ehMaquina = !!TOKEN && token === TOKEN;
  if (!cracha && !ehMaquina) {
    return json({ erro: "Entre no sistema.", semSessao: true }, 401);
  }

  try {
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

      // Conflito por timestamp: servidor mais novo devolve {conflito, servidor}.
      case "upsert": {
        const reg = body.registro;
        if (!reg || reg.id == null) return json({ erro: "registro.id obrigatório" }, 400);
        const id = String(reg.id);
        const atual = await getReg(id);
        if (atual?.atualizadoEm && reg.atualizadoEm &&
            new Date(atual.atualizadoEm).getTime() > new Date(reg.atualizadoEm).getTime()) {
          return json({ conflito: true, servidor: atual });
        }
        // Carimba atualizadoEm NO SERVIDOR, como o original fazia.
        const salvo = { ...reg, id, atualizadoEm: new Date().toISOString() };
        const { error } = await sb.from("dre_registros").upsert(
          { colecao: "os", id, registro: salvo, atualizado_em: salvo.atualizadoEm },
          { onConflict: "colecao,id" });
        if (error) throw new Error(error.message);
        return json({ ok: true, registro: salvo });
      }

      case "delete": {
        const id = String(body.id ?? "");
        if (!id) return json({ erro: "id obrigatório" }, 400);
        await sb.from("dre_registros").delete().eq("colecao", "os").eq("id", id);
        return json({ ok: true });
      }

      case "getCfg": {
        const { data } = await sb.from("dre_config_global").select("config").eq("id", true).maybeSingle();
        return json({ ok: true, cfg: data?.config ?? {} });
      }

      case "setCfg": {
        const { error } = await sb.from("dre_config_global").upsert(
          { id: true, config: body.cfg ?? {}, atualizado_em: new Date().toISOString() },
          { onConflict: "id" });
        if (error) throw new Error(error.message);
        return json({ ok: true });
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
