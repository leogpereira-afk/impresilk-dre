/* ── RECEBÍVEIS E AGING · FASE 5 ─────────────────────────────────────────────
   Só leitura. O Painel (repositório painel-impresilk) grava a cada 20 minutos em
   painel_cache('recebiveis') os títulos a receber em aberto do Mubisys: vencidos
   desde 2015 e a vencer até 90 dias depois da carga (scripts/lib/mubi-cache.mjs,
   normRecebivel). Aqui a posição é agregada com a MESMA régua da tela Contas
   Atrasadas do Painel (src/lib/calc/contasAtrasadas.js), para os dois sistemas
   mostrarem o mesmo vencido:
   - "valor" do item já é o saldo em aberto (título − pago);
   - vencido = vencimento antes de hoje (dias > 0), sem carência; os dias contam até
     hoje, como no Painel, e a posição fica como o carimbo da última carga;
   - dívida vencida antes do corte do Painel (config.parametros.dataCorteAtrasados,
     padrão 2025-01-01) é calote antigo: fica fora de todos os números e aparece à
     parte, como lá.
   Volta pouco: totais, faixas, os maiores devedores e os maiores títulos vencidos,
   sem CNPJ e sem a lista inteira. Nada é gravado e nada ausente vira zero. */
export const CORTE_PADRAO = '2025-01-01';
export const FAIXAS = [
  { id: 'avencer', rotulo: 'A vencer' },
  { id: 'd1_30', rotulo: '1 a 30 dias' },
  { id: 'd31_60', rotulo: '31 a 60 dias' },
  { id: 'd61_90', rotulo: '61 a 90 dias' },
  { id: 'd91', rotulo: 'Acima de 90 dias' },
];
const TOP_CLIENTES = 10, LIMITE_TITULOS = 200, PONTOS_DSO = 90;
// A carga roda de 20 em 20 minutos; o vigia do Painel acusa atraso com 90.
const ATRASO_MIN = 90, ATRASO_FORTE_MIN = 26 * 60;

const cent = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null;
const reais = c => c / 100 + 0;
const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
// Dia em São Paulo (UTC−3, sem horário de verão) de um carimbo com fuso; data do
// ERP sem fuso ("2026-09-15", "2026-09-15 00:00:00", "2026-09-15T00:00:00") vale
// como está, igual à tela do Painel, que corta os 10 primeiros caracteres.
export function diaSP(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
    return Number.isFinite(t) ? new Date(t - 3 * 3600000).toISOString().slice(0, 10) : null;
  }
  const d = s.slice(0, 10);
  return dataOk(d) ? d : null;
}
export const diasEntre = (de, ate) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000);
const faixaDe = dias => dias <= 0 ? 'avencer' : dias <= 30 ? 'd1_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'd91';
// Devedor = o nome do cliente como vem, a mesma chave do "Quem deve" do Painel
// (agruparDividas.porCliente): juntar por documento ou por grafia faria o maior
// devedor do DRE diferente do Painel.
const chaveCliente = r => String(r.cliente ?? '');
const texto = v => String(v ?? '').trim();
const dataBR = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
const media = (itens, dias) => {
  const com = itens.filter(x => dias(x) != null);
  const peso = com.reduce((t, x) => t + x.c, 0);
  return { dias: peso > 0 ? Math.round(com.reduce((t, x) => t + x.c * dias(x), 0) / peso) : null, com: com.length, total: itens.length };
};

const indisponivel = (motivo, extra = {}) => ({ disponivel: false, qualidade: 'Indisponível', posicao: null, totais: null, faixas: null, clientes: null, titulosVencidos: null, prazo: null, avisos: [motivo], ...extra });

// Pura: recebe o que o banco devolveu e a hora da consulta.
export function agregarRecebiveis({ lista, atualizadoEm = null, dsoHist = null, corte = null, agora = new Date() }) {
  const corteOk = dataOk(corte), corteUsado = corteOk ? corte : CORTE_PADRAO, origemCorte = corteOk ? 'painel' : 'padrao';
  const base = diaSP(agora.toISOString()), carga = diaSP(atualizadoEm);
  if (!Array.isArray(lista)) return indisponivel('Os recebíveis ainda não foram carregados pelo Painel.');
  if (!lista.length) return indisponivel('A carga do Painel não trouxe nenhum título em aberto. Sem confirmação de carteira vazia, nenhum zero foi assumido.');
  if (!carga) return indisponivel('A posição dos recebíveis não tem data de atualização: não há como saber de quando são os títulos.');
  const idadeMin = Math.max(0, Math.round((agora.getTime() - Date.parse(atualizadoEm)) / 60000));

  const vistos = new Set(), ativos = [];
  const antigas = { quantidade: 0, c: 0 }, semVencimento = { quantidade: 0, c: 0 };
  let ausentes = 0, repetidos = 0;
  lista.forEach((r, i) => {
    if (!r || typeof r !== 'object') { ausentes++; return; }
    const id = texto(r.id) || 'pos:' + i;
    if (vistos.has(id)) { repetidos++; return; }
    vistos.add(id);
    const c = cent(r.valor);
    if (c == null || c <= 0) { ausentes++; return; }
    const venc = diaSP(r.vencimento);
    if (!venc) { semVencimento.quantidade++; semVencimento.c += c; return; }
    if (venc < corteUsado) { antigas.quantidade++; antigas.c += c; return; }
    const dias = diasEntre(venc, base), emissao = diaSP(r.emissao);
    ativos.push({ id, c, dias, faixa: faixaDe(dias), venc, emissao, chave: chaveCliente(r), cliente: texto(r.cliente) || 'Cliente não informado', nf: texto(r.nf), os: texto(r.os), abatido: Number(r.pago) > 0 });
  });

  // Nenhum título legível (vencimento ou saldo em formato que não se lê): não é carteira zerada.
  if (!ativos.length && semVencimento.quantidade + ausentes > 0)
    return indisponivel(`Nenhum dos ${lista.length} títulos da carga do Painel tem vencimento e saldo legíveis (${semVencimento.quantidade} sem vencimento válido, ${ausentes} sem saldo válido). Sem confirmação de carteira vazia, nenhum zero foi assumido.`, { semVencimento: { quantidade: semVencimento.quantidade, valor: reais(semVencimento.c) }, ausentes });
  const vencidos = ativos.filter(x => x.dias > 0), soma = xs => xs.reduce((t, x) => t + x.c, 0);
  const totAberto = soma(ativos), totVencido = soma(vencidos);
  const faixas = FAIXAS.map(f => { const xs = ativos.filter(x => x.faixa === f.id); return { ...f, valor: reais(soma(xs)), quantidade: xs.length }; });

  // Concentração sobre o vencido: o devedor, não quem só tem título a vencer.
  const grupos = new Map();
  for (const x of ativos) {
    const g = grupos.get(x.chave) || { nome: x.cliente, maior: 0, vencido: 0, aberto: 0, quantidade: 0, maiorAtraso: 0 };
    g.aberto += x.c;
    if (x.dias > 0) { g.vencido += x.c; g.quantidade++; g.maiorAtraso = Math.max(g.maiorAtraso, x.dias); if (x.c > g.maior) { g.maior = x.c; g.nome = x.cliente; } }
    grupos.set(x.chave, g);
  }
  const devedores = [...grupos.values()].filter(g => g.vencido > 0).sort((a, b) => b.vencido - a.vencido || a.nome.localeCompare(b.nome, 'pt-BR'));
  const pctDe = c => totVencido > 0 ? Math.round(c / totVencido * 1000) / 10 : null;
  const resto = devedores.slice(TOP_CLIENTES);

  const ordenados = [...vencidos].sort((a, b) => b.c - a.c || b.dias - a.dias || a.id.localeCompare(b.id));
  const serie = (Array.isArray(dsoHist) ? dsoHist : []).filter(p => p && dataOk(String(p.dia ?? '').slice(0, 10)) && typeof p.dso === 'number' && Number.isFinite(p.dso))
    .map(p => ({ dia: String(p.dia).slice(0, 10), dso: p.dso })).sort((a, b) => a.dia.localeCompare(b.dia)).slice(-PONTOS_DSO);

  const avisos = ['"A vencer" cobre só os títulos que vencem até 90 dias depois da carga do Painel; os mais distantes não vêm na carga.'];
  if (antigas.quantidade) avisos.push(`${antigas.quantidade} título(s) vencido(s) antes de ${dataBR(corteUsado)} ficam fora de todos os números, como na tela Contas Atrasadas do Painel.`);
  if (origemCorte === 'padrao') avisos.push(`O corte de dívida antiga não foi lido na configuração do Painel; foi usado o padrão ${dataBR(CORTE_PADRAO)}.`);
  if (semVencimento.quantidade) avisos.push(`${semVencimento.quantidade} título(s) sem data de vencimento válida ficam fora das faixas e dos totais.`);
  if (ausentes) avisos.push(`${ausentes} título(s) sem saldo válido não foram somados.`);
  if (repetidos) avisos.push(`${repetidos} título(s) repetido(s) não foram somados de novo.`);
  if (idadeMin > ATRASO_FORTE_MIN) avisos.push('A carga do Painel não roda há mais de um dia: os números podem estar bem desatualizados.');
  else if (idadeMin > ATRASO_MIN) avisos.push('A carga do Painel está atrasada: confira a data da posição.');
  const parcial = idadeMin > ATRASO_MIN || origemCorte === 'padrao' || semVencimento.quantidade > 0 || ausentes > 0;

  return {
    disponivel: true,
    qualidade: parcial ? 'Parcial' : 'Apurado',
    posicao: { em: atualizadoEm, carga, base, idadeMin },
    corte: { data: corteUsado, origem: origemCorte },
    totais: { aberto: reais(totAberto), aVencer: reais(soma(ativos.filter(x => x.dias <= 0))), vencido: reais(totVencido), titulos: ativos.length, vencidos: vencidos.length, clientes: grupos.size },
    faixas,
    antigas: { quantidade: antigas.quantidade, valor: reais(antigas.c) },
    semVencimento: { quantidade: semVencimento.quantidade, valor: reais(semVencimento.c) },
    ausentes, repetidos,
    abatidos: { com: ativos.filter(x => x.abatido).length, total: ativos.length },
    clientes: {
      base: 'vencido',
      itens: devedores.slice(0, TOP_CLIENTES).map(g => ({ nome: g.nome, vencido: reais(g.vencido), aberto: reais(g.aberto), quantidade: g.quantidade, maiorAtraso: g.maiorAtraso, participacao: pctDe(g.vencido) })),
      demais: { quantidade: resto.length, vencido: reais(soma(resto.map(g => ({ c: g.vencido })))) },
      devedores: devedores.length,
      top1Pct: devedores.length ? pctDe(devedores[0].vencido) : null,
      top5Pct: devedores.length ? pctDe(soma(devedores.slice(0, 5).map(g => ({ c: g.vencido })))) : null,
    },
    titulosVencidos: ordenados.slice(0, LIMITE_TITULOS).map(x => ({ cliente: x.cliente, nf: x.nf, os: x.os, vencimento: x.venc, dias: x.dias, faixa: x.faixa, valor: reais(x.c) })),
    truncado: ordenados.length > LIMITE_TITULOS,
    // Prazo REAL (pagamento − emissão) não existe na carga do Painel: ela não traz
    // título pago com emissão. Vão dois números do que está em aberto, rotulados.
    prazo: {
      concedido: media(ativos, x => x.emissao ? diasEntre(x.emissao, x.venc) : null),
      idade: media(ativos, x => x.emissao ? diasEntre(x.emissao, base) : null),
      painel: serie.length ? serie[serie.length - 1] : null,
      serie,
    },
    avisos,
  };
}

// Corte de dívida antiga: só esse caminho da configuração do Painel.
export async function consultarRecebiveis(sb, _body = {}, agora = new Date()) {
  const [rec, dso, cfg] = await Promise.all([
    sb.from('painel_cache').select('valor,atualizado_em').eq('chave', 'recebiveis').maybeSingle(),
    sb.from('painel_cache').select('valor,atualizado_em').eq('chave', 'dso_hist').maybeSingle(),
    sb.from('painel_config_global').select('corte:config->parametros->>dataCorteAtrasados').eq('id', true).maybeSingle(),
  ]);
  if (rec?.error) throw new Error('Não foi possível ler os recebíveis do Painel.');
  const r = agregarRecebiveis({
    lista: rec?.data?.valor ?? null,
    atualizadoEm: rec?.data?.atualizado_em ?? null,
    dsoHist: dso?.error ? null : dso?.data?.valor ?? null,
    corte: cfg?.error ? null : cfg?.data?.corte ?? null,
    agora,
  });
  if (r.disponivel && dso?.error) r.avisos.push('O histórico de prazo do Painel não pôde ser lido agora.');
  return { ok: true, versao: 1, fonte: 'recebiveis', ...r };
}
