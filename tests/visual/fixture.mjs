// Base SINTÉTICA do portão visual do DRE Caixa (Impresilk), nascida na auditoria v133.
// Todos os nomes, valores e documentos são fictícios e redondos. Nada aqui vem do ERP.
// Uso: import {AGORA, responderSupabase, dadosResumo} from './fixture.mjs'
// O dispatcher de Indicadores é o MESMO do servidor (dre-sync/indicadores.mjs), alimentado
// por um banco falso em memória: as telas recebem exatamente o formato da produção.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const APP = process.env.APP_DIR || path.resolve(AQUI, '../..');
const modulo = f => import(pathToFileURL(path.join(APP, 'supabase/functions/dre-sync', f)).href);
const {consultarIndicadores} = await modulo('indicadores.mjs');
const {consultarRecebiveis} = await modulo('recebiveis.mjs');
const {consultarGiro} = await modulo('giro.mjs');

// Relógio da auditoria: 22/09/2026, 12h em São Paulo. Set/2026 é o mês corrente (parcial).
export const AGORA = new Date('2026-09-22T15:00:00Z');
export const HOJE = '2026-09-22';
export const MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
// k = índice do mês contado de Jan/2025 (Jan/2025 = 0; 2024 vai de -12 a -1): o ano de 2024 entrou depois
// (comparação entre anos) sem mudar nenhum número de 2025 e 2026.
export const MESES = [];
for (let a = 2024; a <= 2026; a++) for (let m = 1; m <= 12; m++) { if (a === 2026 && m > 9) break; MESES.push({ano: a, m, k: (a - 2025) * 12 + m - 1, label: `${MES[m - 1]}/${a}`, id: `${MES[m - 1]}_${a}`, chave: `${a}-${String(m).padStart(2, '0')}`}); }
const mesK = k => MESES.find(x => x.k === k);
// O Painel (O.S., notas, custo das O.S.) começa em 2025, como antes de 2024 entrar.
const PAINEL = MESES.filter(x => x.k >= 0);
const fimDoMes = (a, m) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
const r100 = v => Math.round(v / 100) * 100;
const pad = (n, k = 2) => String(n).padStart(k, '0');
const mod = (a, n) => ((a % n) + n) % n;

// ── Árvore de contas de um mês ─────────────────────────────────────────────
// Folhas com valor; os pais são a soma das filhas (a árvore fecha em todos os níveis).
// k = índice do mês (0 = Jan/2025). Set/2026 (k=20) é parcial: ~70% do mês.
// 2024 (k < 0): o mesmo mês de 2025 com fator próprio (85%), para a comparação entre anos não repetir 2025.
const MOV = [100000, 110000, 120000, 105000, 115000, 130000, 125000, 140000, 135000, 145000, 150000, 160000,
  120000, 125000, 140000, 130000, 150000, 155000, 165000, 170000, 120000];
const movDe = k => k >= 0 ? MOV[k] : r100(MOV[k + 12] * .85);
const NOMES = {
  '1': 'Entradas', '1.1': 'Comunicação visual', '1.1.1': 'Produtos vendidos', '1.1.1.51': 'Lona front fictícia', '1.1.1.52': 'Adesivo vinil fictício', '1.1.1.53': 'Placa ACM fictícia',
  '1.1.98': 'Recebimentos sem O.S. completa', '1.1.99': 'Produtos aguardando classificação', '1.1.99.51': 'Material Político 2026',
  '1.2': 'Serviços de instalação', '1.3': 'Rendimentos de aplicação', '1.4': 'Empréstimos recebidos', '1.4.2': 'Empréstimo Banco Fictício', '1.7': 'Entradas a identificar',
  '2': 'Saídas', '2.1': 'Despesas com pessoal', '2.1.4': 'Salários', '2.1.9': 'FGTS', '2.1.10': 'INSS', '2.1.12': 'Comissões de vendas',
  '2.2': 'Despesas comerciais e administrativas', '2.2.2': 'Contabilidade', '2.2.3': 'Software e sistemas', '2.2.6': 'Devoluções a clientes',
  '2.4': 'Impostos', '2.4.1': 'DAS', '2.4.1.1': 'Parcelamento do DAS', '2.4.1.2': 'DAS Impresilk', '2.4.1.3': 'DAS Universo', '2.4.2': 'ICMS e DIFAL das compras', '2.4.8': 'ISSQN',
  '2.5': 'Despesas fixas', '2.5.1': 'Água', '2.5.2': 'Energia elétrica', '2.5.3': 'Aluguel do galpão', '2.5.4': 'Internet e telefone',
  '2.12': 'Materiais e insumos', '2.12.1': 'Lonas e vinis', '2.12.2': 'Tintas', '2.12.3': 'Chapas ACM',
  '2.13': 'Despesas financeiras', '2.13.1': 'Tarifas bancárias', '2.13.2': 'Juros', '2.13.6': 'Antecipação de recebíveis',
  '2.14': 'Despesas dos sócios', '2.14.2': 'Retiradas dos sócios', '2.14.3': 'Dívidas dos sócios',
  '2.99': 'Sem plano de contas',
};
function folhasDoMes(k) {
  const {ano, m} = mesK(k), V = movDe(k), parcial = k === 20, f = {};
  // entradas
  f['1.1.1.51'] = r100(V * .30); f['1.1.1.52'] = r100(V * .20); f['1.1.1.53'] = r100(V * .15);
  f['1.1.98'] = r100(V * .10);
  if (ano === 2026 && m >= 7) f['1.1.99.51'] = {7: 20000, 8: 30000, 9: 15000}[m];
  f['1.2'] = r100(V * .15); f['1.3'] = 500;
  if ((ano === 2025 && m === 3) || (ano === 2026 && m === 2)) f['1.4.2'] = 50000;
  if (mod(k, 4) === 1) f['1.7'] = 1000;
  // saídas
  const sal = r100(V * .18);
  f['2.1.4'] = sal; f['2.1.9'] = r100(sal * .08); f['2.1.10'] = r100(sal * .20); f['2.1.12'] = r100(V * .03);
  f['2.2.2'] = 3000; f['2.2.3'] = ano === 2026 && m === 3 ? -400 : 1500; // estorno de software em Mar/2026
  if (mod(k, 3) === 0) f['2.2.6'] = r100(V * .01);
  f['2.4.1.1'] = 2000; f['2.4.1.2'] = r100(V * .045); f['2.4.1.3'] = r100(V * .02); f['2.4.2'] = r100(V * .01); f['2.4.8'] = r100(V * .005);
  f['2.5.1'] = 400; f['2.5.2'] = 3500; f['2.5.3'] = 8000; f['2.5.4'] = ano === 2026 && m === 7 ? -200 : 600; // estorno de telefone em Jul/2026
  f['2.12.1'] = r100(V * .12); f['2.12.2'] = r100(V * .05); f['2.12.3'] = r100(V * .06);
  f['2.13.1'] = 600; f['2.13.2'] = 1200; if (mod(k, 2) === 0) f['2.13.6'] = mod(k, 4) === 0 ? 25000 : 5000;
  f['2.14.2'] = 15000; f['2.14.3'] = 3000;
  if (mod(k, 5) === 2 || k >= 19) f['2.99'] = 800;
  // mês corrente parcial: só o que já passou
  if (parcial) for (const c of Object.keys(f)) if (Math.abs(f[c]) > 1000) f[c] = r100(f[c] * .7);
  return f;
}
function arvore(folhas) {
  const v = {...folhas};
  const codes = Object.keys(folhas);
  for (const c of codes) { const p = c.split('.'); for (let i = p.length - 1; i > 0; i--) { const a = p.slice(0, i).join('.'); v[a] = (v[a] || 0) + folhas[c]; } }
  const ord = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if (x[i] == null) return -1; if (y[i] == null) return 1; if (x[i] !== y[i]) return x[i] - y[i]; } return 0; };
  return Object.keys(v).sort(ord).map(code => { const p = code.split('.'); return {code, name: NOMES[code] || 'Conta ' + code, level: p.length, parent: p.length > 1 ? p.slice(0, -1).join('.') : null, value: Math.round(v[code] * 100) / 100}; });
}

// ── Trilha por pagamento (Jul a Set/2026) ───────────────────────────────────
export const OS_POLITICAS = ['20101', '20102', '20103', '20104', '20105', '20106'];
const CLIENTES = Array.from({length: 12}, (_, i) => `Cliente Fictício ${pad(i + 1)}`);
function eventosDoMes(k, cells, ate) {
  const {ano, m} = mesK(k), filhas = new Set(cells.map(c => c.parent).filter(Boolean)), ev = [];
  let n = 0;
  for (const c of cells) {
    if (filhas.has(c.code) || !c.value || c.code === '1' || c.code === '2') continue;
    const natureza = c.code.startsWith('1') ? 'entrada' : 'saida';
    const partes = Math.abs(c.value) >= 5000 ? [r100(c.value * .6), 0] : [c.value];
    if (partes.length === 2) partes[1] = Math.round((c.value - partes[0]) * 100) / 100;
    partes.forEach((valor, i) => {
      n++;
      const dia = Math.min(Number(ate.slice(8, 10)), 3 + ((n * 7) % 26));
      const pol = c.code === '1.1.99.51';
      ev.push({natureza, empresa: n % 3 ? 'Impresilk' : 'Universo', tituloId: `T${ano}${pad(m)}${pad(n, 3)}`, pagamentoId: `P${ano}${pad(m)}${pad(n, 3)}`, indiceNaColeta: i,
        data: `${ano}-${pad(m)}-${pad(dia)}`, valor, contaOrigem: c.code, nomeConta: c.name, contaGerencial: c.code,
        ordensServico: natureza === 'entrada' ? (pol ? [OS_POLITICAS[n % OS_POLITICAS.length]] : c.code.startsWith('1.1') || c.code === '1.2' ? [String(10000 + k * 100 + n)] : []) : [],
        ...(natureza === 'entrada' ? {cliente: CLIENTES[n % CLIENTES.length]} : {fornecedor: `Fornecedor Fictício ${String.fromCharCode(65 + (n % 8))}`})});
    });
  }
  return ev;
}

// ── Registros mensais (o que dre-sync devolve em list/buscar) ───────────────
export function registros() {
  return MESES.map(({ano, m, k, label, id}) => {
    const cells = arvore(folhasDoMes(k)), parcial = k === 20;
    const ate = parcial ? '2026-09-21' : fimDoMes(ano, m);
    const coletadoEm = parcial ? '2026-09-22T12:00:00Z' : `${m === 12 ? ano + 1 : ano}-${pad(m === 12 ? 1 : m + 1)}-02T09:00:00Z`;
    const conciliado = ano === 2025 && m <= 3;
    const reg = {id, label, company: 'Impresilk + Universo', basis: 'Caixa gerencial', origem: 'erp', atualizadoEm: coletadoEm,
      qualidade: {de: `${ano}-${pad(m)}-01`, ate, coletadoEm, apiContratoValidado: true, conciliado, estado: conciliado ? 'conciliado' : 'aguardando-conferencia', regra: 'caixa-v2', escopo: 'compõe DRE'},
      cells, pendencias: [], eventos: []};
    if (ano === 2026 && m >= 7) {
      reg.eventos = eventosDoMes(k, cells, ate);
      const prod = {};
      for (const c of cells) if (/^1\.1\.(1|99)\.\d+$/.test(c.code)) prod[c.name] = c.value;
      reg.previaERP = {geradoEm: coletadoEm, porCodigo: Object.fromEntries(cells.filter(c => c.code.startsWith('2.')).map(c => [c.code, c.value])), receitaPorProduto: prod, diagOS: {osFaltando: m === 9 ? ['30999'] : []}};
    }
    if (ano === 2026 && m >= 8) reg.pendencias = [
      {tipo: 'Classificação', texto: 'Pagamento sem conta no plano (fictício)', conta: '2.99', valor: 800, tituloId: `T${ano}${pad(m)}900`},
      {tipo: 'Classificação', texto: 'Entrada sem O.S. vinculada (fictícia)', conta: '1.1.98', valor: 1500, tituloId: `T${ano}${pad(m)}901`},
      {tipo: 'Cobertura', texto: 'Título com data de crédito ausente (fictício)', conta: '1.2', valor: 300, tituloId: `T${ano}${pad(m)}902`},
    ];
    return reg;
  });
}

// ── Configuração compartilhada (getCfg) ────────────────────────────────────
export function configuracao(regs = registros()) {
  const em = '2026-09-10T12:00:00Z';
  const simples = {}, operacao = {}, balanco = {};
  // saldo bancário de início de mês coerente com o caixa (saldo de Jan/2025 + entradas − saídas);
  // Jan/2024 começa de trás para frente, para Jan/2025 continuar com 80.000
  const v = (r, c) => r.cells.find(x => x.code === c)?.value || 0;
  let saldo = regs.reduce((s, r, i) => MESES[i].k < 0 ? s - (v(r, '1') - v(r, '2')) : s, 80000);
  regs.forEach((r, i) => {
    const {chave, ano, k} = MESES[i];
    simples[chave] = {impresilk: {anexo: 'III', rbt12: 1200000 + k * 10000, aliquota: 6.5, folha12: 300000, revisadoEm: em}, universo: {anexo: 'I', rbt12: 600000, aliquota: 4.5, folha12: 0, revisadoEm: em}};
    operacao[chave] = {prazoRecebimento: 30, prazoPagamento: 28, estoque: 40000 + mod(k, 4) * 5000, saldoInicial: Math.round(saldo * 100) / 100, metaReceita: ano === 2026 ? 150000 : 130000, metaResultado: 10000, pdd90: 50, revisadoEm: em};
    balanco[chave] = {imobilizado: 250000, emprestimos: 90000 - k * 2000, parcelamentoDAS: 40000 - k * 1000, revisadoEm: em};
    saldo += v(r, '1') - v(r, '2');
  });
  // Mês corrente sem saldo informado no início do mês seguinte: fica para o DFC calcular.
  const tributos = {
    '2.4.1.2': {local: 'Receita Federal', empresa: 'impresilk', recorrencia: 'Mensal', vencimento: 20, previsto: 6500, observacao: 'DAS da Impresilk (fictício)', revisadoEm: em},
    '2.4.1.3': {local: 'Receita Federal', empresa: 'universo', recorrencia: 'Mensal', vencimento: 20, previsto: 2500, observacao: 'DAS da Universo (fictício)', revisadoEm: em},
    '2.4.2': {local: 'Secretaria da Fazenda', empresa: 'impresilk', recorrencia: 'Eventual', vencimento: 10, previsto: 1300, observacao: 'DIFAL das compras (fictício)', revisadoEm: em},
    '2.4.8': {local: 'Prefeitura', empresa: 'universo', recorrencia: 'Mensal', vencimento: 15, previsto: 700, observacao: 'ISSQN (fictício)', revisadoEm: em},
  };
  const parametros = {
    empresas: {impresilk: {cnpj: '11222333000181', sede: 'Cidade Fictícia/MG'}, universo: {cnpj: '11444777000161', sede: 'Cidade Fictícia/MG'}},
    simples, operacao, tributos, balanco,
    historico: [{em, caminho: ['operacao', '2026-09', 'estoque'], anterior: 40000, novo: 45000}, {em, caminho: ['simples', '2026-09', 'impresilk', 'aliquota'], anterior: 6, novo: 6.5}],
  };
  // DRE por competência: Jan a Ago/2026 (Abr com resultado negativo)
  const meses = {};
  for (let m = 1; m <= 8; m++) {
    const V = MOV[11 + m], ruim = m === 4;
    const valores = {produtos: r100(V * .8), servicos: r100(V * .15), outrasVendas: 0, devolucoes: r100(V * .01), descontos: 0, tributosVendas: r100(V * .065), custos: r100(V * .42),
      despesasVendas: r100(V * .05), administrativas: r100(V * (ruim ? .55 : .25)), outrasDespesas: 2000, outrasReceitas: 0, equivalencia: 0,
      receitasFinanceiras: 500, despesasFinanceiras: 1200, tributosLucro: null, tributosDiferidos: null, descontinuadas: 0, da: 3000};
    meses[`${MES[m - 1]}_2026`] = {label: `${MES[m - 1]}/2026`, company: 'Impresilk + Universo', fonte: 'Apuração fictícia para auditoria', notas: 'Valores sintéticos.', basis: 'competencia', valores,
      revisao: `rev-${m}`, revisadoEm: `2026-${pad(m + 1)}-05T12:00:00Z`, estado: 'preenchido', historico: []};
  }
  const gestao = {
    plano: {saldo: 120000, reserva: 30000, inicio: HOJE, cenario: 1, movimentos: [
      {id: 'm1', descricao: 'Recebimento previsto de cliente fictício', data: '2026-09-28', tipo: 'entrada', valor: 40000},
      {id: 'm2', descricao: 'Folha de pagamento (fictícia)', data: '2026-10-05', tipo: 'saida', valor: 35000},
      {id: 'm3', descricao: 'Fornecedor de lonas (fictício)', data: '2026-10-12', tipo: 'saida', valor: 18000}], atualizadoEm: em},
    alertas: {horas: 24, variacao: 15, atualizadoEm: em},
    'orcamento:Set_2026': {entradas: 160000, saidas: 140000, variacao: 20000, fonte: 'Orçamento fictício', atualizadoEm: em},
    'orcamento:Ago_2026': {entradas: 170000, saidas: 150000, variacao: 20000, fonte: 'Orçamento fictício', atualizadoEm: em},
    'metas:2026': {receita: 1800000, custos: 1500000, caixa: 120000, atualizadoEm: em},
    'metas:2025': {receita: 1500000, custos: 1300000, caixa: 100000, atualizadoEm: em},
    'cenario:Ago_2026': {premissas: {}, atualizadoEm: em},
    'fechamento:Jun_2026': {estado: 'fechado', mes: 'Jun/2026', por: 'auditoria', em, itens: [], pendentes: [], justificativa: '', atualizadoEm: em},
    'fechamento:Jul_2026': {estado: 'reaberto', mes: 'Jul/2026', por: 'auditoria', em, motivo: 'Reaberto para conferência (fictício)', atualizadoEm: em},
    historico: [{chave: 'alertas', em, anterior: null, novo: {horas: 24, variacao: 15}}],
  };
  return {parametros, demonstrativosCompetencia: {meses}, gestao};
}

// ── Banco falso do Painel (só leitura) para o dispatcher real de Indicadores ──
const dia = n => new Date(Date.parse(HOJE + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function recebiveisPainel() {
  const lista = [];
  const atrasos = [-60, -40, -25, -10, -3, 0, 5, 12, 20, 28, 35, 45, 58, 70, 85, 95, 120, 150, 200, 260];
  atrasos.forEach((d, i) => lista.push({id: 'R' + (1000 + i), cliente: CLIENTES[i % CLIENTES.length], nf: String(5000 + i), os: String(15000 + i), valor: 1000 * (1 + (i * 7) % 9), pago: i % 5 === 0 ? 200 : 0,
    vencimento: dia(-d), emissao: dia(-d - 30)}));
  lista.push({id: 'R0900', cliente: 'Cliente Fictício Antigo', nf: '4000', os: '9000', valor: 3000, pago: 0, vencimento: '2024-06-10', emissao: '2024-05-10'});
  return lista;
}
function pagarPainel() {
  const cats = ['1.01 Impressão digital (fictício)', '1.04 Serralheria (fictício)', '2.02 Administrativo e RH (fictício)', '3.02 Impostos e taxas', '3.03 Prédio e infraestrutura', '3.01 Sócios (retiradas)', '3.04 Empréstimos e financiamentos', 'Fornecedor sem centro (fictício)'];
  const lista = [];
  const venc = [-40, -15, -5, 0, 3, 8, 15, 22, 30, 45, 55, 95, -100, 10, 18, 26];
  venc.forEach((d, i) => lista.push({id: 'P' + (2000 + i), fornecedor: `Fornecedor Fictício ${String.fromCharCode(65 + i % 8)}`, descricao: `Conta fictícia ${i + 1}`, categoria: cats[i % cats.length], tipo: 'pagar', valor: 1000 * (2 + (i * 5) % 7), pago: 0, vencimento: dia(d)}));
  lista.push({id: 'V1', fornecedor: 'Despesa fixa', descricao: 'Despesa fixa', categoria: 'Despesa fixa', tipo: 'provisao', valor: 12000, vencimento: dia(10)});
  lista.push({id: 'V2', fornecedor: 'Cartão', descricao: 'Cartão', categoria: 'Cartão', tipo: 'provisao', valor: 4000, vencimento: dia(20)});
  lista.push({id: 'V3', fornecedor: 'Folha', descricao: 'Folha', categoria: 'Folha', tipo: 'provisao', valor: 30000, vencimento: dia(13)});
  return lista;
}
function posicoes() {
  return MESES.filter(x => x.k < 20).map(({ano, m, k, label, chave}) => {
    const V = movDe(k);
    return {id: chave, mes: label, fim: fimDoMes(ano, m), regra: 'posicao-v1', modo: 'reconstruido', corte: '2025-01-01', geradoEm: '2026-09-15T10:00:00Z', execucaoId: 'sintetico',
      receber: {total: r100(V * .9), quantidade: 40, faixas: {avencer: r100(V * .6), d1_30: r100(V * .2), d31_60: r100(V * .05), d61_90: r100(V * .03), d91: r100(V * .02)}, antigas: {quantidade: 1, valor: 3000}, foraDRE: {quantidade: 0, valor: 0}, alemHorizonte: {quantidade: 2, valor: 4000}},
      pagar: {total: r100(V * .5), quantidade: 30, faixas: {avencer: r100(V * .4), d1_30: r100(V * .1), d31_60: 0, d61_90: 0, d91: 0},
        porCentro: [{rotulo: '1.01 Impressão digital (fictício)', valor: r100(V * .2), quantidade: 10}, {rotulo: '2.02 Administrativo e RH (fictício)', valor: r100(V * .08), quantidade: 5}, {rotulo: '3.02 Impostos e taxas', valor: r100(V * .07), quantidade: 4}, {rotulo: '3.03 Prédio e infraestrutura', valor: r100(V * .05), quantidade: 3}, {rotulo: '3.04 Empréstimos e financiamentos', valor: r100(V * .1), quantidade: 8}],
        alemPorCentro: [{rotulo: '3.04 Empréstimos e financiamentos', valor: 30000, quantidade: 6}], alemHorizonte: {quantidade: 6, valor: 30000},
        parcelamentoDAS: {valor: 2000, quantidade: 1, porCentro: [{rotulo: '3.02 Impostos e taxas', valor: 2000, quantidade: 1}]}, foraDRE: {quantidade: 0, valor: 0}},
      fluxos: {receber: {emitido: r100(V * 1.0), pago: r100(V * .95), prazoConcedido: 30, prazoReal: 34}, pagar: {emitido: r100(V * .6), pago: r100(V * .55), prazoConcedido: 28, prazoReal: 26, emitidoPorCentro: [{rotulo: '1.01 Impressão digital (fictício)', valor: r100(V * .3)}, {rotulo: '2.02 Administrativo e RH (fictício)', valor: r100(V * .2)}, {rotulo: '3.04 Empréstimos e financiamentos', valor: r100(V * .1)}]}},
      fluxos3m: {receber: {emitido: r100(V * 3), pago: r100(V * 2.8), prazoConcedido: 30, prazoReal: 33}, pagar: {emitido: r100(V * 1.8), pago: r100(V * 1.7), prazoConcedido: 28, prazoReal: 27, emitidoPorCentro: [{rotulo: '1.01 Impressão digital (fictício)', valor: r100(V * .9)}, {rotulo: '2.02 Administrativo e RH (fictício)', valor: r100(V * .6)}, {rotulo: '3.04 Empréstimos e financiamentos', valor: r100(V * .3)}]}},
      cobertura: {titulos: 70, semValor: 0, semEmissao: 0, pagamentoInvalido: 0}};
  });
}
// Recorte de O.S. com custo (intel_detalhes): valores em CENTAVOS, como no Painel.
function recorteOS(ano, m) {
  const desde = `${ano}-${pad(m)}-01`, ate = fimDoMes(ano, m), tipos = ['Normal', 'Normal', 'Normal', 'Garantia'];
  const itens = Array.from({length: 24}, (_, i) => {
    const venda = (2000 + (i * 37) % 11 * 500) * 100, semCusto = i % 9 === 4, prejuizo = i % 11 === 7;
    return {id: `${ano}${pad(m)}${pad(i, 3)}`, numero: String(30000 + (ano - 2025) * 1200 + m * 100 + i), cliente: CLIENTES[i % CLIENTES.length], empresa: i % 3 ? 'Impresilk' : 'Universo', tipo: tipos[i % 4], cancelada: i === 23,
      venda, custo: semCusto ? null : prejuizo ? Math.round(venda * 1.2) : Math.round(venda * (.45 + (i % 5) * .05)),
      previstos: [{nome: 'Impressão', tempo: 30}, {nome: 'Instalação', tempo: 60}], realizados: [{nome: 'Impressão', tempo: i % 2 ? 35 : 0}, {nome: 'Instalação', tempo: 50}]};
  });
  return {completo: true, desde, ate, em: `${ate}T23:00:00Z` > AGORA.toISOString() ? AGORA.toISOString() : `${ate}T23:00:00Z`, itens};
}
function recorteNotas(tipo) {
  const itens = [];
  PAINEL.forEach(({ano, m, k}) => { for (let i = 0; i < 12; i++) {
    const em = `${ano}-${pad(m)}-${pad(3 + i * 2)}`;
    if (em > HOJE) continue;
    itens.push(tipo === 'nfe'
      ? {id: `N${ano}${pad(m)}${pad(i)}`, numero: String(7000 + k * 20 + i), em, destinatario: CLIENTES[i % CLIENTES.length], status: i === 5 ? 'Cancelada' : 'Autorizada', cancelada: i === 5, normal: true, saida: true, valor: (3000 + i * 500) * 100, osIds: [String(10000 + k * 100 + i)]}
      : {id: `C${ano}${pad(m)}${pad(i)}`, numero: String(9000 + k * 20 + i), em, emitente: `Fornecedor Fictício ${String.fromCharCode(65 + i % 8)}`, status: 'Autorizada', cancelada: false, valor: (1500 + i * 300) * 100});
  } });
  return {completo: true, desde: '2025-01-01', ate: '2026-09-30', em: AGORA.toISOString(), itens};
}
function ordensPainel() {
  const out = [];
  PAINEL.forEach(({ano, m, k}) => { for (let i = 0; i < 20; i++) {
    const data = `${ano}-${pad(m)}-${pad(2 + i)}`; if (data > HOJE) continue;
    out.push({id: k * 100 + i + 1, numero: String(10000 + k * 100 + i), data, cliente: CLIENTES[i % CLIENTES.length], vendedor: ['Vendedor Fictício A', 'Vendedor Fictício B', 'Vendedor Fictício C'][i % 3], valor: 2000 + (i % 7) * 1000,
      comercial: {cancelada: i === 19, tipo: i % 10 === 9 ? 'Retrabalho' : 'Normal', valorConfirmado: i % 13 !== 6}, atualizado_em: `${data}T18:00:00Z`});
  } });
  return out;
}
const campanhasPainel = () => [
  {id: 'camp-1', atualizado_em: '2026-09-01T12:00:00Z', nome: 'Política 2026 - Campanha Fictícia', desde: '2026-07-01', ate: '2026-10-31', os: Object.fromEntries(OS_POLITICAS.map((n, i) => ['os' + i, {numero: n}]))},
  {id: 'camp-2', atualizado_em: '2026-05-01T12:00:00Z', nome: 'Feira Regional Fictícia', desde: '2026-04-01', ate: '2026-05-31', os: {a: {numero: '10500'}, b: {numero: '10501'}}},
];

export function bancoFalso() {
  const cargaRec = new Date(AGORA.getTime() - 15 * 60000).toISOString(), cargaPag = new Date(AGORA.getTime() - 18 * 60000).toISOString();
  const cache = {
    recebiveis: {valor: recebiveisPainel(), atualizado_em: cargaRec},
    pagar: {valor: pagarPainel(), atualizado_em: cargaPag},
    dso_hist: {valor: Array.from({length: 90}, (_, i) => ({dia: dia(i - 90), dso: 40 + (i % 10)})), atualizado_em: cargaRec},
    intel_detalhes: {valor: recorteOS(2026, 9), atualizado_em: AGORA.toISOString()},
    intel_nfe: {valor: recorteNotas('nfe'), atualizado_em: AGORA.toISOString()},
    intel_compras: {valor: recorteNotas('compras'), atualizado_em: AGORA.toISOString()},
  };
  const intelArquivo = PAINEL.map(({ano, m}) => { const s = recorteOS(ano, m); return {id: `intel_detalhes:${s.desde}:${s.ate}`, registro: {...s, chave: 'intel_detalhes', arquivadoEm: s.em}}; });
  const pos = posicoes().map(p => ({id: p.id, registro: {...p, gravadoEm: '2026-09-15T10:00:00Z'}}));
  const ordens = ordensPainel(), campanhas = campanhasPainel();
  return {from(tabela) {
    const f = {eq: {}, gte: {}, lte: {}, like: null, in: null, range: null};
    const q = {
      select() { return q; }, order() { return q; }, upsert() { return Promise.resolve({error: new Error('Banco falso: só leitura')}); },
      eq(k, v) { f.eq[k] = v; return q; }, gte(k, v) { f.gte[k] = v; return q; }, lte(k, v) { f.lte[k] = v; return q; },
      like(k, v) { f.like = [k, v]; return q; }, in(k, v) { f.in = [k, v]; return q; }, range(a, b) { f.range = [a, b]; return q; },
      maybeSingle() { const r = resolver(); return Promise.resolve({data: Array.isArray(r) ? r[0] ?? null : r, error: null}); },
      then(ok, err) { return Promise.resolve({data: resolver(), error: null}).then(ok, err); },
    };
    function resolver() {
      if (tabela === 'painel_cache') {
        if (f.in) return f.in[1].filter(c => cache[c]).map(c => ({chave: c, ...cache[c]}));
        return cache[f.eq.chave] || null;
      }
      if (tabela === 'painel_config_global') return {corte: '2025-01-01'};
      if (tabela === 'painel_ordens') { let r = ordens.filter(o => (!f.gte.data || o.data >= f.gte.data) && (!f.lte.data || o.data <= f.lte.data)); if (f.range) r = r.slice(f.range[0], f.range[1] + 1); return r; }
      if (tabela === 'painel_registros' && f.eq.colecao === 'campanhas') return campanhas;
      if (tabela === 'dre_registros') {
        if (f.eq.colecao === 'posicoes') return pos;
        if (f.eq.colecao === 'intel') { const pre = f.like ? f.like[1].replace(/%$/, '') : ''; return intelArquivo.filter(x => x.id.startsWith(pre)).filter(x => !f.eq.id || x.id === f.eq.id); }
      }
      return [];
    }
    return q;
  }};
}

// ── Respostas do Supabase interceptado ─────────────────────────────────────
export const PERMISSOES = {leitura: true, edicao: true, admin: true};
export function coletaStatus() {
  const em = '2026-09-22T12:05:00Z';
  return {configurada: true, ativa: true, estado: 'concluido', pedidoId: null, solicitadoEm: null, iniciadoEm: '2026-09-22T12:00:00Z', runId: 'sintetico-1',
    rotinaVistaEm: em, acionadaEm: null, ultimaConclusao: {runId: 'sintetico-1', em, meses: [{label: 'Ago/2026', estado: 'gravado'}, {label: 'Set/2026', estado: 'gravado'}]},
    ultimaTentativa: {runId: 'sintetico-1', em, meses: [{label: 'Ago/2026', estado: 'gravado'}, {label: 'Set/2026', estado: 'gravado'}]}, horarios: ['06:00', '12:00', '18:00'], fuso: 'America/Sao_Paulo', agora: AGORA.toISOString()};
}
// Uma instância por execução do harness: o estado de setCfg fica só na memória.
export function criarServidor() {
  const regs = registros(), banco = bancoFalso();
  let cfg = configuracao(regs), versao = 'cfg-1';
  const pedidos = [];
  async function responder(url, body) {
    const fn = new URL(url).pathname.split('/').pop();
    pedidos.push(fn + ':' + (body?.action || body?.acao || '?') + (body?.fonte ? ':' + body.fonte : ''));
    if (fn === 'equipe-auth') return {ok: true, sistema: 'dre', usuario: 'equipe', nome: 'Auditoria'};
    if (fn === 'dre-financas') return {ok: false, erro: 'Consulta ao Mubisys desligada na auditoria (dados sintéticos).'};
    switch (body?.action) {
      case 'permissions': return {ok: true, permissoes: PERMISSOES};
      case 'indice': return {ok: true, itens: regs.map(r => ({id: r.id, atualizadoEm: r.atualizadoEm, apagado: false}))};
      case 'buscar': return {ok: true, itens: regs.filter(r => (body.ids || []).includes(r.id))};
      case 'list': return {ok: true, itens: regs, nextOffset: null};
      case 'getCfg': return {ok: true, cfg, atualizadoEm: versao};
      case 'setCfg': cfg = body.cfg; versao = 'cfg-' + (Number(versao.split('-')[1]) + 1); return {ok: true, atualizadoEm: versao};
      case 'coletaStatus': return {ok: true, status: coletaStatus()};
      case 'solicitarColeta': return {ok: true, status: coletaStatus()};
      case 'indicadores': try {
        // Posições (fotos de hoje) com o relógio da auditoria; o resto pelo dispatcher real.
        if (body.fonte === 'recebiveis') return await consultarRecebiveis(banco, body, AGORA);
        if (body.fonte === 'capitalGiro') return await consultarGiro(banco, body, AGORA);
        return await consultarIndicadores(banco, body); } catch (e) { return {ok: false, erro: e.message}; }
      case 'upsert': return {ok: false, erro: 'Gravação desligada na auditoria.'};
      default: return {ok: false, erro: 'Ação desconhecida na fixture: ' + body?.action};
    }
  }
  return {responder, pedidos, registros: regs, get cfg() { return cfg; }};
}
export function dadosResumo() { const r = registros(); return {meses: r.length, contas: new Set(r.flatMap(x => x.cells.map(c => c.code))).size, eventos: r.reduce((t, x) => t + x.eventos.length, 0)}; }
