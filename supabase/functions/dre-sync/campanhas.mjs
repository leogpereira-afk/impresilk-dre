/* ── CAMPANHAS DO PAINEL · FASE 12.1 ─────────────────────────────────────────
   Só leitura. A tela Campanhas do Painel (repositório painel-impresilk) guarda em
   painel_registros, colecao 'campanhas', as O.S. que alguém escolheu à mão para cada
   campanha: registro.os = {idDaOS: {numero, cliente, cnpj, data, valor, ...}}. O DRE
   usa só o NÚMERO da O.S. para achar, nos recebimentos do mês (eventos com
   ordensServico), o dinheiro que entrou de cada campanha, como o material político.
   A escolha continua sendo do Painel: aqui não se deduz campanha pelo nome do cliente.
   Volta pouco: nome, período e os números das O.S. Sem cliente, CNPJ nem valor.
   Campanha de política = nome com "polític" ou "eleiç" ("Política 2026 - Deputados"). */
const POLITICA = /pol[ií]tic|elei[cç]/i;
const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d + 'T00:00:00Z'));

export function resumirCampanhas(linhas) {
  const campanhas = [];
  for (const l of Array.isArray(linhas) ? linhas : []) {
    const nome = String(l?.nome ?? '').trim().slice(0, 120);
    if (!nome) continue;
    const os = l?.os && typeof l.os === 'object' && !Array.isArray(l.os) ? l.os : {};
    const numeros = new Set();
    for (const o of Object.values(os)) {
      const n = String(o?.numero ?? '').trim();
      if (/^\d{3,}$/.test(n)) numeros.add(n);
    }
    campanhas.push({
      id: String(l?.id ?? '').slice(0, 80), nome, politica: POLITICA.test(nome),
      desde: dataOk(l?.desde) ? l.desde : null, ate: dataOk(l?.ate) ? l.ate : null,
      os: [...numeros].sort((a, b) => Number(a) - Number(b)),
    });
  }
  return campanhas.sort((a, b) => String(a.desde || '').localeCompare(String(b.desde || '')) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function consultarCampanhas(sb) {
  // Só os campos usados: a campanha guarda também anexos e histórico, que não descem.
  const { data, error } = await sb.from('painel_registros')
    .select('id,atualizado_em,nome:registro->>nome,desde:registro->>desde,ate:registro->>ate,os:registro->os')
    .eq('colecao', 'campanhas');
  if (error) throw new Error('Não foi possível ler as campanhas do Painel.');
  const campanhas = resumirCampanhas(data);
  const atualizadoEm = (data || []).map(l => l?.atualizado_em).filter(Boolean).sort().at(-1) || null;
  return { ok: true, fonte: 'campanhas', versao: 1, campanhas, atualizadoEm, avisos: campanhas.length ? [] : ['Nenhuma campanha cadastrada no Painel.'] };
}
