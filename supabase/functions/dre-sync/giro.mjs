/* ── CAPITAL DE GIRO · FASE 6.1 (posição de hoje) ───────────────────────────
   Só leitura. Junta duas cargas que o Painel grava em painel_cache a cada ~20 min:
   - 'recebiveis': agregados com a régua da Fase 5 (recebiveis.mjs), o mesmo corte
     de dívida antiga e os dias contados até hoje;
   - 'pagar': títulos a pagar do Mubisys (tipo 'pagar', "valor" = saldo) e as
     projeções que ainda não viraram título (tipo 'provisao': despesa fixa, cartão,
     folha), que ficam à parte e fora do a pagar.
   As contas a pagar são classificadas pelo centro de custo do Mubisys (categoria
   "1.01 Impressão digital/UV", "3.04 Empréstimos..."): primeiro pelo nome (sócio,
   empréstimo/financiamento, imposto/tributo/taxa, prédio/infraestrutura), depois pelo grupo do número (1.xx produção, 2.xx
   apoio), porque o contador renumera o plano e o nome sozinho também muda. Sem
   nome nem número conhecidos = "sem classificação", à vista para ser corrigido.
   Horizonte comum: a carga traz a pagar até 60 dias e a receber até 90 depois da
   carga; a necessidade de giro corta os dois em 60 dias para não somar um lado mais
   longo que o outro.
   Necessidade de capital de giro (sem o estoque, que vem de Parâmetros na tela) =
   a receber − a pagar operacional (fornecedores 1.xx e 2.xx, impostos 3.02 e
   prédio 3.03). Sócios, empréstimos e projeções não entram. Nada ausente vira zero. */
import { agregarRecebiveis, diaSP, diasEntre, CORTE_PADRAO } from './recebiveis.mjs';

export const GRUPOS = [
  { id: 'producao', rotulo: 'Fornecedores de produção (1.xx)', ncg: true },
  { id: 'apoio', rotulo: 'Apoio e administrativo (2.xx)', ncg: true },
  { id: 'impostos', rotulo: 'Impostos e taxas (3.02)', ncg: true },
  { id: 'predio', rotulo: 'Prédio e infraestrutura (3.03)', ncg: true },
  { id: 'socios', rotulo: 'Sócios (3.01)', ncg: false },
  { id: 'emprestimos', rotulo: 'Empréstimos e financiamentos (3.04)', ncg: false },
  { id: 'semClasse', rotulo: 'Sem classificação no Mubisys', ncg: false },
];
export const FAIXAS_PAGAR = [
  { id: 'avencer', rotulo: 'A vencer' },
  { id: 'd1_30', rotulo: 'Vencido 1 a 30 dias' },
  { id: 'd31_60', rotulo: 'Vencido 31 a 60 dias' },
  { id: 'd61_90', rotulo: 'Vencido 61 a 90 dias' },
  { id: 'd91', rotulo: 'Vencido há mais de 90 dias' },
];
const LIMITE_TITULOS = 200, ATRASO_MIN = 90, ATRASO_FORTE_MIN = 26 * 60;
const cent = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) : null;
const reais = c => c / 100 + 0;
const texto = v => String(v ?? '').trim();
const dataOk = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && Number.isFinite(Date.parse(d + 'T00:00:00Z'));
const dataBR = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
const faixaDe = dias => dias <= 0 ? 'avencer' : dias <= 30 ? 'd1_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'd91';

// Classe do centro de custo: nome primeiro, depois o grupo do número ("1.04 Serralheria" → producao).
export function grupoDe(categoria) {
  const t = String(categoria ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/\bsocio|pro.?labore/.test(t)) return 'socios';
  if (/emprestimo|financiamento/.test(t)) return 'emprestimos';
  if (/imposto|tributo|\btaxas?\b/.test(t)) return 'impostos';
  if (/predio|infraestrutura/.test(t)) return 'predio';
  const m = /^\s*(\d)\.(\d{2})(?!\d)/.exec(t);
  if (!m) return 'semClasse';
  if (m[1] === '1') return 'producao';
  if (m[1] === '2') return 'apoio';
  if (m[1] === '3') return { '01': 'socios', '02': 'impostos', '03': 'predio', '04': 'emprestimos' }[m[2]] || 'semClasse';
  return 'semClasse';
}

const indisponivel = (motivo, extra = {}) => ({ disponivel: false, qualidade: 'Indisponível', totais: null, grupos: null, faixas: null, titulos: null, avisos: [motivo], ...extra });

// Pura: os títulos a pagar da carga do Painel, classificados e por faixa de vencimento.
export function agregarPagar({ lista, atualizadoEm = null, corte = null, agora = new Date() }) {
  const corteUsado = dataOk(corte) ? corte : CORTE_PADRAO;
  const base = diaSP(agora.toISOString()), carga = diaSP(atualizadoEm);
  if (!Array.isArray(lista)) return indisponivel('As contas a pagar ainda não foram carregadas pelo Painel.');
  if (!lista.length) return indisponivel('A carga do Painel não trouxe nenhuma conta a pagar. Sem confirmação de que não há contas, nenhum zero foi assumido.');
  if (!carga) return indisponivel('A posição das contas a pagar não tem data de atualização.');
  const idadeMin = Math.max(0, Math.round((agora.getTime() - Date.parse(atualizadoEm)) / 60000));

  const vistos = new Set(), titulos = [], projecoes = new Map();
  const antigas = { quantidade: 0, c: 0 }, semVencimento = { quantidade: 0, c: 0 };
  let ausentes = 0, repetidos = 0, projetadas = 0, projetadoC = 0;
  lista.forEach((r, i) => {
    if (!r || typeof r !== 'object') { ausentes++; return; }
    const tipo = texto(r.tipo) || 'pagar', id = tipo + ':' + (texto(r.id) || 'pos:' + i);
    if (vistos.has(id)) { repetidos++; return; }
    vistos.add(id);
    const c = cent(r.valor);
    if (c == null || c <= 0) { ausentes++; return; }
    // Projeção (despesa fixa, cartão, folha) ainda não é título: fica à parte.
    if (tipo === 'provisao') {
      const rot = texto(r.categoria) || 'Projeção';
      const p = projecoes.get(rot) || { rotulo: rot, c: 0, quantidade: 0 };
      p.c += c; p.quantidade++; projecoes.set(rot, p); projetadas++; projetadoC += c;
      return;
    }
    const venc = diaSP(r.vencimento);
    if (!venc) { semVencimento.quantidade++; semVencimento.c += c; return; }
    if (venc < corteUsado) { antigas.quantidade++; antigas.c += c; return; }
    const dias = diasEntre(venc, base), categoria = texto(r.categoria) || 'Sem centro de custo';
    titulos.push({ c, dias, faixa: faixaDe(dias), venc, categoria, grupo: grupoDe(categoria), fornecedor: texto(r.fornecedor) || 'Sem credor', descricao: texto(r.descricao) });
  });
  if (!titulos.length && semVencimento.quantidade + ausentes > 0)
    return indisponivel(`Nenhuma das ${lista.length} contas da carga do Painel tem vencimento e saldo legíveis (${semVencimento.quantidade} sem vencimento válido, ${ausentes} sem saldo válido). Sem confirmação de que não há contas, nenhum zero foi assumido.`);

  const soma = xs => xs.reduce((t, x) => t + x.c, 0);
  const grupos = GRUPOS.map(g => {
    const xs = titulos.filter(x => x.grupo === g.id), cats = new Map();
    for (const x of xs) { const k = cats.get(x.categoria) || { rotulo: x.categoria, c: 0, quantidade: 0 }; k.c += x.c; k.quantidade++; cats.set(x.categoria, k); }
    return { ...g, valor: reais(soma(xs)), quantidade: xs.length, vencido: reais(soma(xs.filter(x => x.dias > 0))), aVencer: reais(soma(xs.filter(x => x.dias <= 0))),
      categorias: [...cats.values()].sort((a, b) => b.c - a.c || a.rotulo.localeCompare(b.rotulo, 'pt-BR')).map(k => ({ rotulo: k.rotulo, valor: reais(k.c), quantidade: k.quantidade })) };
  });
  const operacional = titulos.filter(x => GRUPOS.find(g => g.id === x.grupo).ncg);
  const semClasse = titulos.filter(x => x.grupo === 'semClasse');
  const ordenados = [...titulos].sort((a, b) => b.c - a.c || b.dias - a.dias);

  const avisos = [];
  if (!dataOk(corte)) avisos.push(`O corte de dívida antiga não foi lido na configuração do Painel; foi usado o padrão ${dataBR(CORTE_PADRAO)}.`);
  if (semClasse.length) avisos.push(`${semClasse.length} conta(s) sem número de centro de custo no Mubisys ficam fora do a pagar operacional até serem reclassificadas.`);
  if (antigas.quantidade) avisos.push(`${antigas.quantidade} conta(s) vencida(s) antes de ${dataBR(corteUsado)} ficam fora dos números, com o mesmo corte dos recebíveis.`);
  if (semVencimento.quantidade) avisos.push(`${semVencimento.quantidade} conta(s) sem data de vencimento válida ficam fora das faixas e dos totais.`);
  if (ausentes) avisos.push(`${ausentes} conta(s) sem saldo válido não foram somadas.`);
  if (repetidos) avisos.push(`${repetidos} conta(s) repetida(s) não foram somadas de novo.`);
  if (idadeMin > ATRASO_FORTE_MIN) avisos.push('A carga do Painel não roda há mais de um dia: as contas a pagar podem estar bem desatualizadas.');
  else if (idadeMin > ATRASO_MIN) avisos.push('A carga das contas a pagar está atrasada: confira a data da posição.');

  return {
    disponivel: true,
    qualidade: semClasse.length || semVencimento.quantidade || ausentes || idadeMin > ATRASO_MIN || !dataOk(corte) ? 'Parcial' : 'Apurado',
    posicao: { em: atualizadoEm, carga, base, idadeMin },
    corte: { data: corteUsado, origem: dataOk(corte) ? 'painel' : 'padrao' },
    totais: { titulos: reais(soma(titulos)), operacional: reais(soma(operacional)), vencidoOperacional: reais(soma(operacional.filter(x => x.dias > 0))), semClasse: reais(soma(semClasse)), quantidade: titulos.length },
    grupos,
    faixas: FAIXAS_PAGAR.map(f => { const xs = operacional.filter(x => x.faixa === f.id); return { ...f, valor: reais(soma(xs)), quantidade: xs.length }; }),
    projetado: { quantidade: projetadas, valor: reais(projetadoC), categorias: [...projecoes.values()].sort((a, b) => b.c - a.c).map(p => ({ rotulo: p.rotulo, valor: reais(p.c), quantidade: p.quantidade })) },
    antigas: { quantidade: antigas.quantidade, valor: reais(antigas.c) },
    semVencimento: { quantidade: semVencimento.quantidade, valor: reais(semVencimento.c) },
    ausentes, repetidos,
    titulos: ordenados.slice(0, LIMITE_TITULOS).map(x => ({ fornecedor: x.fornecedor, descricao: x.descricao, categoria: x.categoria, grupo: x.grupo, vencimento: x.venc, dias: x.dias, valor: reais(x.c) })),
    truncado: ordenados.length > LIMITE_TITULOS,
    avisos,
  };
}

export const HORIZONTE_DIAS = 60;
const somaDias = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Posição de hoje: a receber (régua da Fase 5) e a pagar classificado, no mesmo horizonte; o estoque entra na tela.
export async function consultarGiro(sb, _body = {}, agora = new Date()) {
  const [rec, pag, cfg] = await Promise.all([
    sb.from('painel_cache').select('valor,atualizado_em').eq('chave', 'recebiveis').maybeSingle(),
    sb.from('painel_cache').select('valor,atualizado_em').eq('chave', 'pagar').maybeSingle(),
    sb.from('painel_config_global').select('corte:config->parametros->>dataCorteAtrasados').eq('id', true).maybeSingle(),
  ]);
  if (rec?.error || pag?.error) throw new Error('Não foi possível ler as contas a receber e a pagar do Painel.');
  const corte = cfg?.error ? null : cfg?.data?.corte ?? null;
  const p = agregarPagar({ lista: pag?.data?.valor ?? null, atualizadoEm: pag?.data?.atualizado_em ?? null, corte, agora });
  // Os recebíveis vão até 90 dias depois da carga; as contas a pagar, até 60. Corta os dois no mesmo dia.
  const cargaRef = diaSP(pag?.data?.atualizado_em) || diaSP(rec?.data?.atualizado_em), limite = cargaRef ? somaDias(cargaRef, HORIZONTE_DIAS) : null;
  const listaRec = rec?.data?.valor, fora = { quantidade: 0, c: 0 };
  const dentro = Array.isArray(listaRec) && limite ? listaRec.filter(x => {
    const v = diaSP(x?.vencimento);
    if (v && v > limite) { const c = cent(x?.valor); if (c != null && c > 0) { fora.quantidade++; fora.c += c; } return false; }
    return true;
  }) : listaRec ?? null;
  const r = agregarRecebiveis({ lista: dentro, atualizadoEm: rec?.data?.atualizado_em ?? null, dsoHist: null, corte, agora });
  const receber = r.disponivel ? { disponivel: true, qualidade: r.qualidade, posicao: r.posicao, corte: r.corte, totais: r.totais, faixas: r.faixas, antigas: r.antigas, prazo: { concedido: r.prazo.concedido, idade: r.prazo.idade }, avisos: r.avisos } : { disponivel: false, avisos: r.avisos };
  const ncgSemEstoque = r.disponivel && p.disponivel ? reais(Math.round(r.totais.aberto * 100) - Math.round(p.totais.operacional * 100)) : null;
  // Avisos que mudam a leitura do número, dos dois lados (sem os de janela, que a tela diz no card).
  const janela = a => /^"A vencer" cobre/.test(a);
  const avisos = [...(r.disponivel ? r.avisos.filter(a => !janela(a)).map(a => 'A receber: ' + a) : []), ...(p.disponivel ? p.avisos.filter(a => !janela(a)).map(a => 'A pagar: ' + a) : [])];
  const emRec = Date.parse(rec?.data?.atualizado_em ?? ''), emPag = Date.parse(pag?.data?.atualizado_em ?? '');
  const descasadas = Number.isFinite(emRec) && Number.isFinite(emPag) && Math.abs(emRec - emPag) > 90 * 60000;
  if (descasadas) avisos.unshift('As cargas do Painel são de horários diferentes: a necessidade de giro junta a receber e a pagar de momentos distintos.');
  return {
    ok: true, versao: 1, fonte: 'capitalGiro',
    disponivel: r.disponivel || p.disponivel,
    qualidade: r.disponivel && p.disponivel ? (r.qualidade === 'Apurado' && p.qualidade === 'Apurado' && !descasadas ? 'Apurado' : 'Parcial') : 'Indisponível',
    horizonte: { dias: HORIZONTE_DIAS, ate: limite, receberFora: { quantidade: fora.quantidade, valor: reais(fora.c) } },
    receber, pagar: p,
    ncg: { semEstoque: ncgSemEstoque, receber: r.disponivel ? r.totais.aberto : null, pagarOperacional: p.disponivel ? p.totais.operacional : null },
    avisos,
    historico: null,
  };
}
