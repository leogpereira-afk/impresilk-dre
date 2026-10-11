/* ── ARQUIVO DAS IMPORTAÇÕES DO PAINEL · FASE 9.3 ────────────────────────────
   O Painel guarda em painel_cache UM recorte de cada importação "Inteligência"
   (intel_nfe: notas emitidas; intel_compras: notas de compra; intel_detalhes: O.S.
   com custo): importar outro período apaga o anterior. A rotina de coleta do DRE
   chama 'intelArquivar' a cada passagem e cada recorte completo fica guardado em
   dre_registros (coleção 'intel'), por fonte e período, sem mudar nada no Painel.
   Na consulta dos Indicadores, quando o recorte de hoje não cobre o período, vale o
   arquivo: o recorte exato (O.S., que precisam do recorte igual) ou o que cobre o
   período (notas); um intervalo de vários meses inteiros junta os recortes mensais
   quando todos existem (mês que ainda não chegou não é exigido). Sem recorte,
   continua "sem importação": nada é inventado. */
export const INTEL_CHAVES = ['intel_nfe', 'intel_compras', 'intel_detalhes'];
const MAX_ITENS = 20000;
const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d + 'T00:00:00Z'));
export const recorteValido = s => !!s && typeof s === 'object' && !Array.isArray(s) && s.completo === true && dataOk(s.desde) && dataOk(s.ate) && s.desde <= s.ate && Array.isArray(s.itens) && s.itens.length <= MAX_ITENS;
const maisNovo = (a, b) => String(b.em ?? '').localeCompare(String(a.em ?? ''));
const fimDoMes = ym => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
function mesesDe(de, ate) {
  const out = []; let d = new Date(de.slice(0, 7) + '-01T00:00:00Z');
  while (d.toISOString().slice(0, 7) <= ate.slice(0, 7) && out.length < 400) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}
const mesSP = agora => new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 7);

// Guarda cada recorte completo do Painel uma vez (o mesmo retrato não é regravado).
export async function arquivarIntel(sb, agora = new Date()) {
  const { data, error } = await sb.from('painel_cache').select('chave,valor').in('chave', INTEL_CHAVES);
  if (error) throw new Error('Não foi possível ler as importações do Painel.');
  const arquivos = [];
  for (const r of data || []) {
    const s = r?.valor;
    if (!INTEL_CHAVES.includes(r?.chave) || !recorteValido(s)) { arquivos.push({ chave: r?.chave ?? null, estado: 'incompleto' }); continue; }
    const id = `${r.chave}:${s.desde}:${s.ate}`;
    const { data: atual, error: e1 } = await sb.from('dre_registros').select('em:registro->>em').eq('colecao', 'intel').eq('id', id).maybeSingle();
    if (e1) throw new Error('Não foi possível conferir o arquivo das importações.');
    if (atual && String(atual.em ?? '') === String(s.em ?? '')) { arquivos.push({ chave: r.chave, id, estado: 'igual' }); continue; }
    const em = agora.toISOString();
    const { error: e2 } = await sb.from('dre_registros').upsert({ colecao: 'intel', id, registro: { ...s, chave: r.chave, arquivadoEm: em }, atualizado_em: em }, { onConflict: 'colecao,id' });
    if (e2) throw new Error('Arquivo das importações não gravado.');
    arquivos.push({ chave: r.chave, id, estado: 'gravado' });
  }
  return { ok: true, arquivos };
}

// O recorte arquivado para o período: um só (exato ou que cobre) ou os meses juntos.
// Devolve { recorte } ou { faltam: ['2026-01', ...] } ou null.
export async function recorteArquivado(sb, chave, p, exato, agora = new Date()) {
  const { data, error } = await sb.from('dre_registros').select('id,registro').eq('colecao', 'intel').like('id', chave + ':%');
  if (error) throw new Error('Não foi possível ler o arquivo das importações.');
  const recs = (data || []).map(r => r?.registro).filter(s => recorteValido(s) && (s.chave ?? chave) === chave);
  // Recorte importado antes do fim do próprio período pode não ter o resto do mês: dito.
  const antes = s => String(s.em ?? '').slice(0, 10) < s.ate;
  const fonte = s => ({ em: s.em ?? null, corte: s.ate, periodo: `${s.desde} a ${s.ate}`, conciliado: false });
  const um = recs.filter(s => exato ? s.desde === p.de && s.ate === p.ate : s.desde <= p.de && s.ate >= p.ate).sort(maisNovo)[0];
  if (um) return { recorte: { ...um, partes: 1, fontes: [fonte(um)], antesDoFim: antes(um) ? [`${um.desde} a ${um.ate}`] : [] } };
  const meses = mesesDe(p.de, p.ate);
  if (meses.length < 2 || p.de !== meses[0] + '-01' || p.ate !== fimDoMes(meses[meses.length - 1])) return null;
  const hoje = mesSP(agora), exigidos = meses.filter(ym => ym <= hoje);
  if (!exigidos.length) return null;
  const partes = exigidos.map(ym => recs.filter(s => s.desde === ym + '-01' && s.ate === fimDoMes(ym)).sort(maisNovo)[0] || null);
  const faltam = exigidos.filter((_, i) => !partes[i]);
  if (faltam.length) return { faltam };
  const vistos = new Set(), itens = [];
  for (const s of partes) for (const it of s.itens) { const k = String(it?.id ?? ''); if (k && vistos.has(k)) continue; if (k) vistos.add(k); itens.push(it); }
  const futuros = meses.filter(ym => ym > hoje);
  return { recorte: { completo: true, desde: p.de, ate: p.ate, em: partes.map(s => String(s.em ?? '')).sort()[0] || null, itens, partes: partes.length, fontes: partes.map(fonte), antesDoFim: partes.filter(antes).map(s => `${s.desde} a ${s.ate}`), futuros } };
}
