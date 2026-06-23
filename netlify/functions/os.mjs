// netlify/functions/os.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Backend único da aplicação: um "roteador de ações" sobre o Netlify Blobs.
//
// Contrato: o cliente faz POST /.netlify/functions/os com JSON
//   { action: 'upsert' | 'list' | 'delete' | 'ping' | ... , ...payload }
// e um header  x-token  igual ao process.env.TOKEN. Toda resposta é JSON.
//
// Função v2 (Request/Response). O endpoint é o nome do arquivo: "/os".
// ─────────────────────────────────────────────────────────────────────────────
import { getStore } from '@netlify/blobs';

// Stores separados por TIPO de dado. Cada registro = 1 blob com chave = id.
//  - registros : as ordens de serviço (1 blob por id)
//  - config    : configuração global (poucas chaves)
//  - fotos      : imagens em base64 (1 blob por id de foto), separadas porque
//                 são grandes e não devem inflar o list() dos registros.
const STORES = { registros: 'os-registros', config: 'os-config', fotos: 'os-fotos' };

// Helper que abre um store tentando primeiro o CONTEXTO AUTOMÁTICO (disponível
// quando a função roda dentro do Netlify) e, se falhar, cai num FALLBACK manual
// usando as env vars BLOBS_SITE_ID / BLOBS_TOKEN (útil em testes locais ou se o
// contexto automático não estiver presente).
function store(name) {
  try {
    return getStore(name); // contexto automático (produção, na nuvem)
  } catch {
    const siteID = process.env.BLOBS_SITE_ID;
    const token = process.env.BLOBS_TOKEN;
    if (!siteID || !token) throw new Error('Blobs sem contexto e sem BLOBS_SITE_ID/BLOBS_TOKEN');
    return getStore({ name, siteID, token }); // fallback explícito
  }
}

// Resposta JSON padronizada (sempre application/json).
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export default async (req) => {
  // Só aceitamos POST: todas as ações vão no corpo.
  if (req.method !== 'POST') return json({ erro: 'Use POST' }, 405);

  // 1) Autenticação por token (comparação simples de string).
  //    LIMITAÇÃO: o token vive no config.js que vai ao navegador, então é
  //    VISÍVEL no DevTools. Protege contra acesso casual/bots, NÃO é segurança
  //    forte. Para dados sensíveis, use login real (sessão/JWT) com segredo só
  //    no servidor.
  const esperado = process.env.TOKEN;
  if (!esperado) return json({ erro: 'TOKEN não configurado no servidor' }, 500);
  if (req.headers.get('x-token') !== esperado) return json({ erro: 'Token inválido' }, 401);

  // 2) Corpo JSON.
  let body;
  try { body = await req.json(); }
  catch { return json({ erro: 'JSON inválido' }, 400); }
  const { action } = body || {};

  try {
    switch (action) {
      // ── healthcheck ────────────────────────────────────────────────────────
      case 'ping':
        return json({ ok: true });

      // ── listagem PAGINADA ───────────────────────────────────────────────────
      // Listar só as CHAVES é leve; o pesado é baixar o conteúdo. Por isso
      // paginamos: trazemos no máximo PAGE itens por resposta para nunca passar
      // do limite de ~6 MB da função. cursor = offset; devolvemos nextOffset
      // (ou null quando acabou).
      case 'list': {
        const PAGE = 150;
        const offset = Math.max(0, parseInt(body.offset, 10) || 0);
        const reg = store(STORES.registros);
        const { blobs } = await reg.list();          // só metadados/chaves
        const keys = blobs.map((b) => b.key).sort();
        const fatia = keys.slice(offset, offset + PAGE);
        const itens = await Promise.all(
          fatia.map((k) => reg.get(k, { type: 'json' }))
        );
        const nextOffset = offset + PAGE < keys.length ? offset + PAGE : null;
        return json({ ok: true, itens: itens.filter(Boolean), total: keys.length, nextOffset });
      }

      // ── upsert com DETECÇÃO DE CONFLITO por timestamp ────────────────────────
      // Se o registro no servidor for MAIS NOVO que o enviado, devolvemos
      // { conflito:true, servidor } sem sobrescrever (o cliente decide o que
      // fazer). Caso contrário gravamos e carimbamos atualizadoEm no servidor.
      case 'upsert': {
        const reg = body.registro;
        if (!reg || reg.id == null) return json({ erro: 'registro.id obrigatório' }, 400);
        const id = String(reg.id);
        const s = store(STORES.registros);

        const atual = await s.get(id, { type: 'json' });
        if (atual && atual.atualizadoEm && reg.atualizadoEm &&
            new Date(atual.atualizadoEm) > new Date(reg.atualizadoEm)) {
          return json({ conflito: true, servidor: atual });
        }

        // Carimbo do servidor: a hora autoritativa é a do servidor. O cliente
        // deve adotar o registro devolvido para manter os relógios alinhados.
        reg.atualizadoEm = new Date().toISOString();
        await s.setJSON(id, reg);
        return json({ ok: true, registro: reg });
      }

      // ── delete (registro + fotos associadas) ─────────────────────────────────
      case 'delete': {
        const id = body.id != null ? String(body.id) : null;
        if (!id) return json({ erro: 'id obrigatório' }, 400);
        const s = store(STORES.registros);
        const reg = await s.get(id, { type: 'json' });
        await s.delete(id);

        // Apaga as fotos referenciadas pelo registro (campos que guardam ids de
        // foto). Varremos o objeto procurando strings/arrays de ids de foto.
        const fotos = store(STORES.fotos);
        const ids = new Set();
        for (const v of Object.values(reg || {})) {
          if (typeof v === 'string' && v.startsWith('foto:')) ids.add(v);
          if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && x.startsWith('foto:') && ids.add(x));
        }
        await Promise.all([...ids].map((k) => fotos.delete(k)));
        return json({ ok: true, removidas: ids.size });
      }

      // ── config global (store separado) ───────────────────────────────────────
      case 'getCfg': {
        const cfg = await store(STORES.config).get('global', { type: 'json' });
        return json({ ok: true, cfg: cfg || {} });
      }
      case 'setCfg': {
        await store(STORES.config).setJSON('global', body.cfg || {});
        return json({ ok: true });
      }

      // ── fotos em base64 (store separado) ─────────────────────────────────────
      case 'putPhoto': {
        if (!body.id || !body.data) return json({ erro: 'id e data obrigatórios' }, 400);
        // Guardamos a string base64 (data URL). Chave prefixada com "foto:".
        const key = String(body.id).startsWith('foto:') ? String(body.id) : 'foto:' + body.id;
        await store(STORES.fotos).set(key, body.data);
        return json({ ok: true, id: key });
      }
      case 'getPhoto': {
        const key = String(body.id).startsWith('foto:') ? String(body.id) : 'foto:' + body.id;
        const data = await store(STORES.fotos).get(key, { type: 'text' });
        if (data == null) return json({ erro: 'não encontrada' }, 404);
        return json({ ok: true, id: key, data });
      }

      default:
        return json({ erro: 'ação desconhecida: ' + action }, 400);
    }
  } catch (e) {
    return json({ erro: String(e && e.message || e) }, 500);
  }
};
