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
// verify_jwt = false: a autorizacao e o x-token conferido aqui dentro.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN = Deno.env.get("DRE_TOKEN") ?? "";
const BUCKET = "dre-arquivos";

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

  const token = req.headers.get("x-token") ?? body.token;
  if (!TOKEN || token !== TOKEN) return json({ erro: "Não autorizado" }, 401);

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
