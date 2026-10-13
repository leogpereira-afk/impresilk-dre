/* ── COMPARATIVOS ANUAIS · DASHBOARD (Fase 12) ──────────────────────────────
   Os anos lado a lado, das mesmas linhas da DRE Simples (DRESimples.apurar), em %
   das vendas, crescimento e índice, como no PDF "Comparativo anual" de 12/10/2026:
   vendas (índice nos mesmos meses, eleição, sazonalidade, o ano de referência mês a
   mês), receita (mix e produtos), a DRE ano a ano, margens, custos variáveis,
   despesas fixas e o que acontece depois do resultado (sócios, investimentos, dívida).
   No fim, a leitura em texto, gerada dos próprios números.
   Regras:
   - ano de referência = o do mês escolhido na barra, até o último mês COMPLETO (mês em
     andamento ou coletado pela metade fica fora);
   - custos e despesas só dos meses com plano de contas: até 10% das saídas sem conta
     (2.99). Em 2020 e no começo de 2021 quase tudo era lançado sem plano de contas;
   - crescimento compara os mesmos meses dos dois anos; o índice de vendas usa os
     mesmos meses em todos os anos (janeiro até o mês de referência);
   - nada vira zero: ano sem dado aparece como "·";
   - material político (Fase 12.1): a conta 1.5, o produto "Material Político" das O.S.
     (que o robô deixava em 1.1.99, sem conta) e, nos meses com a trilha dos
     recebimentos, o dinheiro das O.S. marcadas nas campanhas de Política do Painel. O
     marcador "Incluir material político" tira esse valor das vendas nos painéis de
     venda; a DRE, as margens e as despesas continuam com ele (o custo não se separa). */
const CMP_SEM_CONTA_MAX = 10;
const CMP_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const CMP_CHAVE_POLITICA = 'impresilk_dre_cmp_sem_politica';
const cmpUI = { chave: '', modelo: null, semPolitica: false, abertos: {}, campanhas: null, campErro: '', campBusy: false, campEm: 0, campSeq: 0 };
try { cmpUI.semPolitica = typeof localStorage !== 'undefined' && localStorage.getItem(CMP_CHAVE_POLITICA) === '1'; } catch { cmpUI.semPolitica = false; }
const cmpCacheAp = new WeakMap();
function cmpAp(reg) { if (!cmpCacheAp.has(reg)) cmpCacheAp.set(reg, typeof DRESimples !== 'undefined' ? DRESimples.apurar(reg) : null); return cmpCacheAp.get(reg); }
const cmpNorm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cmpNum = v => typeof v === 'number' && Number.isFinite(v);
// O sinal sai do valor já arredondado: -0,04 com uma casa mostra 0,0, sem "−0,0".
const cmpArred = (v, d) => Math.round(v * 10 ** d) / 10 ** d + 0;
const cmpFmt = (v, d = 1) => cmpNum(v) ? (cmpArred(v, d) < 0 ? '−' : '') + Math.abs(cmpArred(v, d)).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '·';
const cmpVar = (v, d = 1) => cmpNum(v) ? (cmpArred(v, d) > 0 ? '+' : cmpArred(v, d) < 0 ? '−' : '') + Math.abs(cmpArred(v, d)).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%' : '·';
// Crescimento nas tabelas: seta e valor sem sinal; a cor (tomDelta) diz se foi boa notícia pela direção da linha.
const cmpVarSeta = (v, d = 1) => cmpNum(v) ? (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + cmpVar(Math.abs(v), d).replace(/^\+/, '') : '·';
const CMP_DIR = { vendas: 1, vendasSemPolitico: 1, variaveis: -1, margem: 1, pessoal: -1, fixas: -1, resultado: 1, socios: 0, dividas: 0 };
const cmpTomVar = (dir, v) => typeof tomDelta === 'function' && cmpNum(v) ? tomDelta(dir, v) : '';
const cmpSoma = (xs, f) => xs.reduce((t, x) => t + (Number(f(x)) || 0), 0);
function cmpMesesTexto(ms) {
  const s = [...new Set(ms)].sort((a, b) => a - b); if (!s.length) return '';
  if (s.length === 12) return 'ano inteiro';
  const seguidos = s.every((m, i) => !i || m === s[i - 1] + 1);
  return seguidos ? (s.length === 1 ? CMP_MES[s[0] - 1] : `${CMP_MES[s[0] - 1]} a ${CMP_MES[s[s.length - 1] - 1]}`) : s.map(m => CMP_MES[m - 1]).join(', ');
}
// Meses seguidos viram faixa: "mar/2020 a fev/2021".
function cmpFaixasMeses(xs) {
  const g = []; for (const x of xs) { const k = x.ano * 12 + x.mes, u = g[g.length - 1]; if (u && k === u.k + 1) { u.fim = x; u.k = k; } else g.push({ ini: x, fim: x, k }); }
  const r = x => `${CMP_MES[x.mes - 1]}/${x.ano}`;
  return g.map(f => f.ini === f.fim ? r(f.ini) : `${r(f.ini)} a ${r(f.fim)}`);
}

// ── Material político ───────────────────────────────────────────────────────
// Três sinais, do mais antigo ao mais preciso:
// 1) a conta 1.5 (Material Político), quando o ERP já classificou assim (2024 e parte de 2026);
// 2) o produto "Material Político" das O.S. (previaERP.receitaPorProduto: "Material Politico",
//    "xMaterial Político 2022x", "Material Político 2026"), que o robô deixava em 1.1.99;
// 3) nos meses com a trilha dos recebimentos (eventos com o número da O.S.), o dinheiro das
//    O.S. que o Painel marcou nas campanhas de Política (tela Campanhas: escolha feita à mão).
// O mês fica com o maior entre (1+2) e (3): cada um só pode deixar algo de fora, nunca contar
// a mais, porque os dois medem o mesmo dinheiro por caminhos diferentes. Por isso, no sinal (3),
// o título que paga O.S. da campanha junto com outras fica de fora.
const cmpEhPolitico = nome => /material\s*politic/.test(cmpNorm(nome));
// "xMaterial Político 2022x" é o nome de um produto desativado no Mubisys; "*" marca a ficha viva.
function cmpNomeProduto(nome) {
  let s = String(nome ?? '').trim().replace(/\*+\s*$/, '').trim();
  const m = s.match(/^x(.+)x$/);
  if (m && /^[A-ZÀ-Ý]/.test(m[1])) s = m[1].trim();
  return s;
}
function cmpOsPoliticas() {
  const c = cmpUI.campanhas; if (!c || !Array.isArray(c.campanhas)) return null;
  const s = new Set(); for (const k of c.campanhas) if (k?.politica) for (const n of k.os || []) s.add(String(n));
  return s.size ? s : null;
}
function cmpPolitico(reg, ap, osPol) {
  const vendas = ap ? Math.max(0, ap.linhas.vendas) : 0;
  const conta = (ap?.composicao?.vendas || []).filter(i => /^1\.5(\.|$)/.test(String(i.code))).reduce((t, i) => t + i.valor, 0);
  // produto que o robô já pôs em 1.5 (ex.: "Material Político 2024" em 1.5.51) não conta duas vezes
  const em15 = new Set((reg.cells || []).filter(c => /^1\.5\./.test(String(c?.code || ''))).map(c => cmpNorm(cmpNomeProduto(c.name))));
  const prev = reg.previaERP?.receitaPorProduto;
  let produto = 0;
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
    for (const [n, v] of Object.entries(prev)) if (cmpEhPolitico(n) && !em15.has(cmpNorm(cmpNomeProduto(n))) && Number.isFinite(Number(v))) produto += Number(v);
  } else for (const c of reg.cells || []) {
    const code = String(c?.code || '');
    if (/^1\.1\.(1|99)\.\d+$/.test(code) && cmpEhPolitico(c.name) && Number.isFinite(Number(c.value))) produto += Number(c.value);
  }
  let porOS = null;
  const ev = Array.isArray(reg.eventos) ? reg.eventos.filter(e => e?.natureza === 'entrada') : [];
  if (osPol && ev.length) {
    porOS = 0;
    for (const e of ev) {
      const v = Number(e.valor); if (!Number.isFinite(v)) continue;
      // entrada classificada fora das vendas (rendimento, empréstimo, a identificar) não é material político
      if (e.contaGerencial && !/^1\.(1|2|5|6)(\.|$)/.test(String(e.contaGerencial))) continue;
      const ns = [...new Set((Array.isArray(e.ordensServico) ? e.ordensServico : []).map(String))], pol = ns.filter(n => osPol.has(n)).length;
      // Título que paga O.S. da campanha e outras ao mesmo tempo fica de fora: sem o valor de
      // cada O.S., repartir pela quantidade poderia contar a mais (e o mês fica com o maior sinal).
      if (pol && pol === ns.length) porOS += v;
      else if (!ns.length && /^1\.5(\.|$)/.test(String(e.contaGerencial || ''))) porOS += v;
    }
  }
  const sinais = conta + produto, bruto = porOS != null ? Math.max(sinais, porOS) : sinais;
  const valor = Math.min(Math.max(0, bruto), vendas);
  return { valor, conta, produto, porOS, excesso: Math.max(0, valor - conta - produto), fonte: porOS != null && porOS > sinais + .005 ? 'os' : 'produto' };
}

// ── O modelo: tudo calculado uma vez por base e mês escolhido ────────────────
function cmpMeses() {
  const hoje = typeof dfcHoje === 'function' ? dfcHoje() : new Date().toISOString().slice(0, 10);
  const regs = (typeof dedupePeriods === 'function' ? dedupePeriods(state.records).kept : [...state.records]).filter(r => monthSortKey(r.label) >= 0).sort((a, b) => monthSortKey(a.label) - monthSortKey(b.label));
  const osPol = cmpOsPoliticas();
  return regs.map(reg => {
    const [m, a] = String(reg.label).split('/'), mes = PT_MON.indexOf(m) + 1, ano = Number(a), ap = cmpAp(reg), per = F.periodo(reg.label), q = F.qualidade(reg);
    const fechado = !!ap && !!per && per.ate < hoje && !q.parcial;
    const pol = ap ? cmpPolitico(reg, ap, osPol) : { valor: 0, conta: 0, produto: 0, porOS: null, excesso: 0, fonte: 'produto' };
    const pct = ap?.pctSemConta ?? null;
    const nomes = new Map((reg.cells || []).filter(c => c?.code).map(c => [String(c.code), c.name || '']));
    return { reg, label: reg.label, ano, mes, ap, fechado, classificado: fechado && (pct == null || pct <= CMP_SEM_CONTA_MAX), pctSemConta: pct, vendas: ap ? ap.linhas.vendas : null, politico: pol.valor, pol, nomes };
  });
}
const CMP_LINHAS = ['vendas', 'das', 'impostosVendas', 'devolucoes', 'receitaLiquida', 'variaveis', 'margemContribuicao', 'pessoal', 'ocupacao', 'administrativas', 'veiculos', 'marketing', 'taxas', 'fixasOutras', 'fixas', 'ebitda', 'receitasFinanceiras', 'despesasFinanceiras', 'resultado', 'socios', 'investimentos', 'dividas', 'transferencias', 'semDetalhamento', 'emprestimos', 'aIdentificar', 'foraOutras', 'variacao'];
const CMP_DETALHES = [
  ['variaveis', 'Custos variáveis'], ['pessoal', 'Pessoal'], ['administrativas', 'Administrativas e terceiros'], ['ocupacao', 'Ocupação e utilidades'], ['veiculos', 'Veículos'],
  ['socios', 'Retiradas e arrendamento (sócios)'], ['investimentos', 'Investimentos e parcelas de ativos'], ['dividas', 'Dívidas pagas'], ['emprestimos', 'Empréstimos recebidos'], ['semDetalhamento', 'Saídas sem detalhamento'],
];
// Rótulo de cada conta no detalhe: o nome da conta de 3º nível (as renomeadas pelo robô
// se juntam pelo nome); alguns grupos ganham um nome que diz o que são.
function cmpRotuloItem(linha, it, nomes) {
  const code = String(it.code), p = code.split('.');
  if (linha === 'investimentos') return /^2\.13\.7|^2\.14\.3\.4/.test(code) ? 'Parcelas de financiamento de equipamentos' : 'Compras de máquinas, veículos e outros investimentos';
  if (linha === 'dividas' && /^2\.4\.1/.test(code)) return 'Parcelamento do DAS';
  if (linha === 'variaveis') {
    if (/^2\.12\.(5[1-9]|[6-9]\d)|^2\.(5[1-9]|[6-8]\d|9[0-8])(\.|$)/.test(code)) return 'Materiais e serviços em contas renomeadas';
    if (/^2\.6(\.|$)/.test(code)) return 'Máquinas: manutenção e insumos';
    if (code === '2.12') return 'Materiais sem subgrupo';
    if (/^2\.4\.2/.test(code)) return 'ICMS e DIFAL das compras';
  }
  if (linha === 'semDetalhamento' && code === '2.99') return 'Títulos sem plano de contas';
  if (linha === 'emprestimos') return (p.length >= 3 && nomes.get(p.slice(0, 3).join('.'))) || 'Empréstimos sem subconta';
  const k3 = p.length >= 3 ? p.slice(0, 3).join('.') : code;
  return nomes.get(k3) || it.name || code;
}
function cmpModelo() {
  const meses = cmpMeses(); if (!meses.some(x => x.fechado)) return null;
  // Referência: o ano do mês escolhido, até o último mês fechado dele.
  const [pm, pa] = String(state.periodo || '').split('/');
  let refAno = Number(pa) || meses[meses.length - 1].ano, refMes = PT_MON.indexOf(pm) + 1 || 12;
  const fechRef = meses.filter(x => x.ano === refAno && x.mes <= refMes && x.fechado).map(x => x.mes);
  if (fechRef.length) refMes = Math.max(...fechRef); else { refAno -= 1; refMes = 12; }
  const primeiro = meses.find(x => x.fechado).ano;
  const anos = []; for (let a = primeiro; a <= refAno; a++) anos.push(a);
  if (!anos.length) return null;
  const doAno = (a, ateMes) => meses.filter(x => x.ano === a && x.fechado && x.mes <= ateMes);
  // Marcador desmarcado: os painéis de venda usam as vendas sem o material político.
  const sem = !!cmpUI.semPolitica, vb = x => (Number(x.vendas) || 0) - (sem ? x.politico : 0);
  // Resumo de um ano até um mês: o ano inteiro, o de referência até o mês dele ou o anterior nos mesmos meses.
  const resumoAno = (ano, ateMes) => {
    const todos = doAno(ano, ateMes), cls = todos.filter(x => x.classificado);
    const vendas = cmpSoma(todos, x => x.vendas), politico = cmpSoma(todos, x => x.politico), vc = cmpSoma(cls, x => x.vendas);
    const linhas = {}, pct = {};
    for (const k of CMP_LINHAS) { linhas[k] = cls.length ? cmpSoma(cls, x => x.ap.linhas[k]) : null; pct[k] = cls.length && vc > 0 ? linhas[k] / vc * 100 : null; }
    pct.deducoes = pct.das != null ? pct.das + pct.impostosVendas + pct.devolucoes : null;
    pct.outrasEntradas = pct.aIdentificar != null ? pct.aIdentificar + pct.foraOutras : null;
    pct.pe = cls.length && linhas.margemContribuicao > 0 ? linhas.fixas / linhas.margemContribuicao * 100 : null;
    pct.sociosResultado = cls.length && linhas.resultado > 0 ? linhas.socios / linhas.resultado * 100 : null;
    return { ano, meses: todos.map(x => x.mes), mesesCls: cls.map(x => x.mes), todos, cls, vendas, politico, vendasBase: cmpSoma(todos, vb), politicoCls: cmpSoma(cls, x => x.politico), vendasCls: vc, linhas, pct };
  };
  const porAno = anos.map(a => resumoAno(a, a < refAno ? 12 : refMes)).filter(p => p.todos.length);
  // Ano de referência pela metade: o anterior nos mesmos meses é a base justa da tabela da DRE e da leitura.
  const mesmoPeriodo = refMes < 12 ? resumoAno(refAno - 1, refMes) : null;
  // Índice de vendas nos mesmos meses (janeiro até o mês de referência), em todos os anos que os têm.
  const idx = porAno.map(p => { const xs = meses.filter(x => x.ano === p.ano && x.fechado && x.mes <= refMes); return xs.length === refMes ? { ano: p.ano, vendas: cmpSoma(xs, x => x.vendas), politico: cmpSoma(xs, x => x.politico) } : null; }).filter(Boolean);
  const base = idx[0] ? idx[0].vendas - (sem ? idx[0].politico : 0) : null;
  const indice = base > 0 ? idx.map(i => ({ ano: i.ano, vendas: i.vendas, politico: i.politico, valor: (i.vendas - (sem ? i.politico : 0)) / base * 100, semPolitico: (i.vendas - i.politico) / base * 100, extra: sem ? 0 : i.politico / base * 100 })) : [];
  // Crescimento de cada linha contra os mesmos meses do ano anterior.
  const LCRESC = [
    ['vendas', 'Vendas', x => x.vendas, false], ['vendasSemPolitico', 'Vendas sem material político', x => x.vendas - x.politico, false],
    ['variaveis', 'Custos variáveis', x => x.ap.linhas.variaveis, true], ['margem', 'Margem de contribuição', x => x.ap.linhas.margemContribuicao, true],
    ['pessoal', 'Pessoal', x => x.ap.linhas.pessoal, true], ['fixas', 'Despesas fixas (total)', x => x.ap.linhas.fixas, true],
    ['resultado', 'Resultado antes dos sócios', x => x.ap.linhas.resultado, true], ['socios', 'Retiradas e arrendamento (sócios)', x => x.ap.linhas.socios, true],
    ['dividas', 'Dívidas pagas', x => x.ap.linhas.dividas, true],
  ];
  const pares = porAno.slice(1).map((p, i) => ({ a0: porAno[i].ano, a1: p.ano }));
  const cresc = (a0, a1, f, soCls) => {
    const lim = a1 === refAno ? refMes : 12, ms = []; let s0 = 0, s1 = 0;
    for (let m = 1; m <= lim; m++) {
      const ok = x => x && x.fechado && (!soCls || x.classificado);
      const x0 = meses.find(x => x.ano === a0 && x.mes === m), x1 = meses.find(x => x.ano === a1 && x.mes === m);
      if (ok(x0) && ok(x1)) { ms.push(m); s0 += Number(f(x0)) || 0; s1 += Number(f(x1)) || 0; }
    }
    return ms.length >= 3 && s0 > 0 ? { valor: s1 / s0 * 100 - 100, meses: ms } : null;
  };
  const crescimento = { pares: pares.map(pr => ({ ...pr, meses: cresc(pr.a0, pr.a1, x => x.vendas, false)?.meses || [] })), linhas: LCRESC.map(([chave, rotulo, f, soCls]) => ({ chave, rotulo, soCls, valores: pares.map(pr => cresc(pr.a0, pr.a1, f, soCls)) })) };
  // Sazonalidade: cada mês contra a média mensal do ano, nos anos inteiros.
  const cheios = porAno.filter(p => p.meses.length === 12);
  const saz = cheios.length ? CMP_MES.map((_, i) => {
    const vs = cheios.map(p => { const media = p.vendasBase / 12, x = p.todos.find(t => t.mes === i + 1); return media > 0 && x ? vb(x) / media * 100 : null; }).filter(cmpNum);
    return vs.length ? { mes: i + 1, indice: vs.reduce((t, v) => t + v, 0) / vs.length, min: Math.min(...vs), max: Math.max(...vs) } : null;
  }) : [];
  // O ano de referência mês a mês contra o mesmo mês do ano anterior.
  const mesAMes = []; for (let m = 1; m <= 12; m++) {
    const a = meses.find(x => x.ano === refAno && x.mes === m && x.fechado && m <= refMes), b = meses.find(x => x.ano === refAno - 1 && x.mes === m && x.fechado);
    mesAMes.push({ mes: m, valor: a && b && vb(b) > 0 ? vb(a) / vb(b) * 100 - 100 : null });
  }
  // Mix da receita: as contas de venda de 2º nível (1.1, 1.2, 1.5, 1.6...).
  const ultimoNome = new Map(); for (const x of meses) for (const [c, n] of x.nomes) if (n && n !== c) ultimoNome.set(c, n);
  // O material político vira uma linha só (a conta 1.5 entra nela); o que estava no produto
  // ou nas O.S. da campanha sai de Comunicação Visual (1.1), onde o robô o deixava.
  const mixMapas = porAno.map(p => {
    const g = new Map();
    for (const x of p.todos) {
      const gm = new Map();
      for (const it of x.ap.composicao.vendas || []) { const k = String(it.code).split('.').slice(0, 2).join('.'); if (k !== '1.5') gm.set(k, (gm.get(k) || 0) + it.valor); }
      const prod = Math.min(x.pol.produto, x.politico - x.pol.conta), k11 = gm.has('1.1') ? '1.1' : [...gm.keys()].sort((a, b) => gm.get(b) - gm.get(a))[0];
      if (prod && k11) gm.set(k11, gm.get(k11) - prod);
      const exc = x.pol.excesso, pos = [...gm.values()].filter(v => v > 0).reduce((t, v) => t + v, 0);
      if (exc > 0 && pos > 0) for (const [k, v] of gm) if (v > 0) gm.set(k, v - exc * v / pos);
      for (const [k, v] of gm) g.set(k, (g.get(k) || 0) + v);
      if (!sem) g.set('~pol', (g.get('~pol') || 0) + x.politico);
    }
    return g;
  });
  const mixCod = [...new Set(mixMapas.flatMap(g => [...g.keys()]))].sort((a, b) => (a === '~pol') - (b === '~pol') || a.localeCompare(b, 'pt-BR', { numeric: true }));
  const mix = mixCod.map(k => ({ rotulo: k === '~pol' ? 'Material político (eleições)' : ultimoNome.get(k) || k, politico: k === '~pol', valores: porAno.map((p, i) => p.vendasBase > 0 ? (mixMapas[i].get(k) || 0) / p.vendasBase * 100 : null) })).filter(l => l.valores.some(v => v >= 0.05));
  // Produtos: o rateio do recebido pelos itens das O.S. (previaERP.receitaPorProduto), pelo
  // nome do produto. As contas de produto (1.1.1.x, 1.1.99.x) não servem: o código de cada
  // produto muda de um mês para outro. Mês sem a prévia (planilha) usa as contas pelo nome.
  // O recebido sem O.S. completa (1.1.98) fica numa linha à parte.
  const prodAnos = porAno.filter(p => p.vendas > 0).slice(-5), prod = new Map();
  const somaProd = (ano, k, rot, v) => { const e = prod.get(k) || { rotulo: rot, v: new Map() }; e.rotulo = rot; e.v.set(ano, (e.v.get(ano) || 0) + v); prod.set(k, e); };
  for (const p of prodAnos) for (const x of p.todos) {
    const prev = x.reg.previaERP?.receitaPorProduto;
    const itens = (prev && typeof prev === 'object' && !Array.isArray(prev) ? Object.entries(prev)
      : (x.reg.cells || []).filter(c => /^1\.1\.(1|99)\.\d+$/.test(String(c?.code || ''))).map(c => [c.name, c.value])).map(([n, v]) => [n, Number(v)]).filter(([, v]) => Number.isFinite(v) && v);
    const cel98 = (x.reg.cells || []).find(c => String(c?.code) === '1.1.98'), v98 = Number(cel98?.value);
    // Sem o material político, o dinheiro das O.S. da campanha que o robô rateou em produtos de
    // nome comum (lona, adesivo) ou deixou sem O.S. sai de cada um na proporção, como do total.
    const comuns = itens.filter(([n, v]) => !cmpEhPolitico(n) && v > 0).reduce((t, [, v]) => t + v, 0) + (v98 > 0 ? v98 : 0);
    const fator = sem && x.pol.excesso > 0 && comuns > 0 ? Math.max(0, 1 - x.pol.excesso / comuns) : 1;
    for (const [n, v] of itens) {
      if (cmpEhPolitico(n)) somaProd(p.ano, '~pol', 'Material político (produto)', v);
      else { const rot = cmpNomeProduto(n) || 'Produto sem nome'; somaProd(p.ano, cmpNorm(rot), rot, v > 0 ? v * fator : v); }
    }
    if (Number.isFinite(v98) && v98) somaProd(p.ano, '~semos', 'Recebido sem O.S. completa', v98 > 0 ? v98 * fator : v98);
  }
  const produtosTodos = [...prod.entries()].map(([k, e]) => ({ k, rotulo: e.rotulo, valores: prodAnos.map(p => e.v.has(p.ano) && p.vendasBase > 0 ? e.v.get(p.ano) / p.vendasBase * 100 : null) }));
  const semOS = produtosTodos.find(x => x.k === '~semos') || null, produtoPolitico = sem ? null : produtosTodos.find(x => x.k === '~pol') || null;
  const maxV = l => Math.max(0, ...l.valores.filter(cmpNum));
  const produtos = produtosTodos.filter(x => !x.k.startsWith('~')).sort((a, b) => maxV(b) - maxV(a)).slice(0, 12);
  // Detalhe de cada linha, nos meses com plano de contas.
  const detalhes = {};
  for (const [linha] of CMP_DETALHES) {
    const g = new Map();
    porAno.forEach((p, i) => { for (const x of p.cls) for (const it of x.ap.composicao[linha] || []) { const rot = cmpRotuloItem(linha, it, x.nomes), k = cmpNorm(rot); const e = g.get(k) || { rotulo: rot, codes: new Set(), v: porAno.map(() => 0) }; e.v[i] += it.valor; e.codes.add(String(it.code)); g.set(k, e); } });
    const itens = [...g.values()].map(e => ({ rotulo: e.rotulo, codes: [...e.codes], valores: porAno.map((p, i) => p.cls.length && p.vendasCls > 0 ? (e.v[i] ? e.v[i] / p.vendasCls * 100 : null) : null) }));
    detalhes[linha] = itens.sort((a, b) => maxV(b) - maxV(a));
  }
  // De onde veio o material político: meses medidos pelas O.S. das campanhas do Painel.
  const pelasOS = meses.filter(x => x.fechado && x.pol.porOS != null);
  return { refAno, refMes, meses, porAno, mesmoPeriodo: mesmoPeriodo?.cls.length ? mesmoPeriodo : null, indice, crescimento, saz, mesAMes, mix, produtos, prodAnos: prodAnos.map(p => p.ano), semOS, produtoPolitico, detalhes, semPolitica: sem, pelasOS };
}

// ── Gráficos (as mesmas peças do app: GX, classes de cor, dica e tabela) ────
function cmpGrade(esc, H, fmt) {
  const { e, p } = GX;
  return {
    svg: esc.ticks.map(t => `<line class="${t === 0 ? 'g-base' : 'g-grade-linha'}" x1="0" x2="${GX.W}" y1="${esc.y(t, H).toFixed(2)}" y2="${esc.y(t, H).toFixed(2)}" vector-effect="non-scaling-stroke"/>`).join(''),
    html: esc.ticks.map(t => `<span class="g-rot g-rot-y" style="top:${p(esc.y(t, H), H)}">${e(fmt(t))}</span>`).join(''),
  };
}
// Colunas empilhadas (índice de vendas com a parte da eleição destacada).
function cmpGrafColunas(cols, op) {
  const { e, p } = GX, H = op.H || 200;
  const mx = Math.max(1, ...cols.map(c => c.partes.reduce((t, x) => t + Math.max(0, x.valor || 0), 0)));
  const esc = GX.escala(0, mx), g = cmpGrade(esc, H, op.eixo || (t => String(t)));
  const n = cols.length, banda = GX.W / n, bw = banda * (op.largura || .46);
  let svg = g.svg, rot = g.html;
  cols.forEach((c, i) => {
    const x = i * banda + (banda - bw) / 2, cx = i * banda + banda / 2; let topo = 0;
    c.partes.forEach(pt => { if (!(pt.valor > 0)) return; const y1 = esc.y(topo + pt.valor, H), y2 = esc.y(topo, H); svg += `<rect class="g-marca-dado g-cor-${pt.cor}" x="${x.toFixed(2)}" y="${y1.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(1.5, y2 - y1).toFixed(2)}" vector-effect="non-scaling-stroke"/>`; topo += pt.valor; });
    svg += `<rect class="g-alvo" x="${(i * banda).toFixed(2)}" y="0" width="${banda.toFixed(2)}" height="${H}" data-dica="${e(c.dica)}"/>`;
    rot += `<span class="g-rot g-rot-x" style="left:${p(cx, GX.W)}">${e(c.rotulo)}</span>`;
    if (c.topo) rot += `<span class="g-rot g-rot-forte" style="left:${p(cx, GX.W)};top:${p(esc.y(topo, H), H)};transform:translate(-50%,-125%)">${e(c.topo)}</span>`;
  });
  return GX.figura('cmp-colunas g-cartesiano', op.leitura, `<div class="g-area" style="height:${H}px">${GX.svg(H, svg)}<div class="g-rotulos">${rot}</div></div>`, GX.legenda(op.legenda || []), op.tabela || '');
}
// Barras para cima e para baixo do zero (o ano de referência contra o anterior, mês a mês).
function cmpGrafVariacao(itens, op) {
  const { e, p } = GX, H = op.H || 170, vs = itens.map(i => i.valor).filter(cmpNum);
  if (!vs.length) return GX.aviso('cmp-var', 'Não apurado: sem meses para comparar.');
  const esc = GX.escala(Math.min(0, ...vs), Math.max(0, ...vs)), g = cmpGrade(esc, H, t => (t > 0 ? '+' : t < 0 ? '−' : '') + Math.abs(t) + '%');
  const n = itens.length, banda = GX.W / n, bw = banda * .5, y0 = esc.y(0, H);
  let svg = g.svg, rot = g.html, lacunas = '';
  itens.forEach((it, i) => {
    const x = i * banda + (banda - bw) / 2, cx = i * banda + banda / 2;
    rot += `<span class="g-rot g-rot-x" style="left:${p(cx, GX.W)}">${e(it.rotulo)}</span>`;
    if (!cmpNum(it.valor)) { lacunas += `<span class="g-sem-dado" style="left:${p(i * banda + banda * .2, GX.W)};width:${p(banda * .6, GX.W)}"></span>`; return; }
    const y = esc.y(it.valor, H), ya = Math.min(y, y0), yb = Math.max(y, y0);
    svg += `<rect class="g-marca-dado g-cor-${it.valor >= 0 ? 'entrada' : 'saida'}" x="${x.toFixed(2)}" y="${ya.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(1.5, yb - ya).toFixed(2)}" vector-effect="non-scaling-stroke" data-dica="${e(`${it.dica}\n${cmpVar(it.valor)}`)}"/>`;
    rot += `<span class="g-rot g-rot-forte g-opcional" style="left:${p(cx, GX.W)};top:${p(it.valor >= 0 ? ya : yb, H)};transform:translate(-50%,${it.valor >= 0 ? '-125%' : '25%'})">${e(cmpVar(it.valor, 0))}</span>`;
  });
  return GX.figura('cmp-var g-cartesiano', op.leitura, `<div class="g-area" style="height:${H}px">${GX.svg(H, svg)}<div class="g-rotulos">${rot}${lacunas}</div></div>`, GX.legenda([{ rotulo: 'Acima do ano anterior', cor: 'entrada' }, { rotulo: 'Abaixo', cor: 'saida' }, ...(lacunas ? [{ rotulo: 'sem mês completo', semDado: true }] : [])]), op.tabela || '');
}
// Linhas de % das vendas, um eixo só, rótulo do último valor e dica por ano.
function cmpGrafLinhas(rotulos, series, op) {
  const { e, p } = GX, H = op.H || 210;
  const vals = series.flatMap(s => s.valores.filter(cmpNum)); if (!vals.length) return GX.aviso('cmp-linhas', 'Não apurado: sem anos com plano de contas.');
  const esc = GX.escala(Math.min(0, ...vals), Math.max(...vals)), g = cmpGrade(esc, H, t => t + '%');
  const n = rotulos.length, banda = GX.W * .9 / n, xs = rotulos.map((_, i) => i * banda + banda / 2);
  let svg = g.svg, rot = g.html, pontos = '';
  series.forEach(s => {
    let d = '', aberto = false;
    s.valores.forEach((v, i) => { if (!cmpNum(v)) { aberto = false; return; } const y = esc.y(v, H); d += `${aberto ? 'L' : 'M'}${xs[i].toFixed(2)} ${y.toFixed(2)} `; aberto = true; pontos += `<span class="g-ponto g-cor-${s.cor}" style="left:${p(xs[i], GX.W)};top:${p(y, H)}"></span>`; });
    if (d) svg += `<path class="g-linha g-cor-${s.cor}" d="${d.trim()}" vector-effect="non-scaling-stroke"/>`;
  });
  rotulos.forEach((r, i) => {
    rot += `<span class="g-rot g-rot-x" style="left:${p(xs[i], GX.W)}">${e(r)}</span>`;
    svg += `<rect class="g-alvo" x="${(i * banda).toFixed(2)}" y="0" width="${banda.toFixed(2)}" height="${H}" data-dica="${e([r, ...series.map(s => `${s.rotulo}: ${cmpNum(s.valores[i]) ? cmpFmt(s.valores[i]) + '%' : 'sem dado'}`)].join('\n'))}"/>`;
  });
  // rótulo do último valor de cada série, sem sobrepor (afasta pelo menos 7% da altura)
  const fins = series.map(s => { const i = s.valores.map((v, k) => cmpNum(v) ? k : -1).filter(k => k >= 0).pop(); return i == null ? null : { y: esc.y(s.valores[i], H), x: xs[i], txt: cmpFmt(s.valores[i]) + '%' }; }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let i = 1; i < fins.length; i++) if (fins[i].y - fins[i - 1].y < H * .09) fins[i].y = fins[i - 1].y + H * .09;
  for (const f of fins) rot += `<span class="g-rot g-rot-forte" style="left:${p(f.x, GX.W)};top:${p(f.y, H)};transform:translate(8px,-50%)">${e(f.txt)}</span>`;
  return GX.figura('cmp-linhas g-cartesiano', op.leitura, `<div class="g-area" style="height:${H}px">${GX.svg(H, svg)}<div class="g-rotulos">${rot}${pontos}</div></div>`, GX.legenda(series.map(s => ({ rotulo: s.rotulo, cor: s.cor, linha: true }))), op.tabela || '');
}
// Barras 100% por ano: para onde vai cada R$ 100 vendidos.
function cmpGrafCem(linhas, series, op) {
  const { e, p } = GX;
  const rows = linhas.map(l => {
    const vs = l.valores.map(v => Math.max(0, v || 0)), tot = vs.reduce((t, v) => t + v, 0);
    if (!(tot > 0)) return `<div class="g-linha-h"><span class="g-nome">${e(l.rotulo)}</span><div class="g-cem-barra"><span class="g-sem-dado" style="left:0;width:100%"></span></div></div>`;
    let x = 0, rects = '', rots = '';
    vs.forEach((v, k) => {
      const w = v / tot * GX.W; if (w <= 0) return;
      rects += `<rect class="g-marca-dado g-cor-${series[k].cor}" x="${(x + (x ? 1.5 : 0)).toFixed(2)}" y="0" width="${Math.max(1, w - (x ? 1.5 : 0)).toFixed(2)}" height="28" data-dica="${e(`${l.rotulo}\n${series[k].rotulo}: ${cmpFmt(l.valores[k])}% das vendas`)}"/>`;
      if (w / GX.W >= .07) rots += `<span class="g-rot-dentro cmp-tinta-${k + 1}" style="left:${p(x + w / 2, GX.W)}">${e(Math.round(l.valores[k]) + '%')}</span>`;
      x += w;
    });
    return `<div class="g-linha-h"><span class="g-nome">${e(l.rotulo)}</span><div class="g-cem-barra">${GX.svg(28, rects)}${rots}</div></div>`;
  }).join('');
  return GX.figura('cmp-cem', op.leitura, `<div class="g-linhas">${rows}</div>`, GX.legenda(series.map(s => ({ rotulo: s.rotulo, cor: s.cor }))), op.tabela || '');
}
// Barras lado a lado (empréstimos recebidos e dívidas pagas): o que entrou em azul e o que saiu em vermelho.
function cmpGrafGrupos(rotulos, series, op) {
  const { e, p } = GX, H = op.H || 180, vals = series.flatMap(s => s.valores.filter(cmpNum));
  if (!vals.length) return GX.aviso('cmp-grupos', 'Não apurado: sem anos com plano de contas.');
  const esc = GX.escala(0, Math.max(1, ...vals)), g = cmpGrade(esc, H, t => t + '%');
  const n = rotulos.length, banda = GX.W / n, bw = banda * .26;
  let svg = g.svg, rot = g.html;
  rotulos.forEach((r, i) => {
    const cx = i * banda + banda / 2;
    series.forEach((s, k) => {
      const v = s.valores[i]; if (!cmpNum(v)) return;
      const x = k === 0 ? cx - bw - 4 : cx + 4, y = esc.y(v, H), yb = esc.y(0, H);
      svg += `<rect class="g-marca-dado g-cor-${s.cor}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(1.5, yb - y).toFixed(2)}" vector-effect="non-scaling-stroke" data-dica="${e(`${r}\n${s.rotulo}: ${cmpFmt(v)}% das vendas`)}"/>`;
      rot += `<span class="g-rot g-opcional" style="left:${p(x + bw / 2, GX.W)};top:${p(y, H)};transform:translate(-50%,-125%)">${e(cmpFmt(v))}</span>`;
    });
    rot += `<span class="g-rot g-rot-x" style="left:${p(cx, GX.W)}">${e(r)}</span>`;
  });
  return GX.figura('cmp-grupos g-cartesiano', op.leitura, `<div class="g-area" style="height:${H}px">${GX.svg(H, svg)}<div class="g-rotulos">${rot}</div></div>`, GX.legenda(series.map(s => ({ rotulo: s.rotulo, cor: s.cor }))), op.tabela || '');
}
// Faixa da sazonalidade: um quadrado por mês, do mais claro (fraco) ao mais escuro (forte).
function cmpFaixaSazonal(saz, op) {
  const { e } = GX, vs = saz.filter(Boolean).map(s => s.indice); if (!vs.length) return GX.aviso('cmp-saz', 'Não apurado: ainda não há um ano inteiro.');
  const mn = Math.min(...vs), mx = Math.max(...vs);
  const cel = s => { if (!s) return `<div><div class="g-sem-dado" style="position:static;height:26px"></div></div>`; const passo = mx === mn ? 3 : 1 + Math.min(4, Math.floor((s.indice - mn) / (mx - mn) * 5)); return `<div><div class="g-cor-seq-${passo}" style="height:26px;border-radius:5px" data-dica="${e(`${CMP_MES[s.mes - 1]}\nÍndice ${Math.round(s.indice)} (100 = mês médio)\nde ${Math.round(s.min)} a ${Math.round(s.max)} nos anos inteiros`)}"></div><div style="text-align:center;font-size:12px;margin-top:4px;color:var(--g-texto-2)">${CMP_MES[s.mes - 1]}</div><div style="text-align:center;font-size:13px;font-weight:650;color:var(--g-texto)">${Math.round(s.indice)}</div></div>`; };
  return GX.figura('cmp-saz', op.leitura, `<div style="display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px">${saz.map(cel).join('')}</div>`, `<div class="g-legenda"><span class="g-leg">mais fraco <span class="g-escala" aria-hidden="true">${[1, 2, 3, 4, 5].map(k => `<i class="g-cor-seq-${k}"></i>`).join('')}</span> mais forte</span></div>`, op.tabela || '');
}

// ── Tabelas ─────────────────────────────────────────────────────────────────
function cmpTabela(cab, linhas, op = {}) {
  const sub = new Set(op.subtotais || []), dest = new Set(op.destaques || []), rec = new Set(op.recuo || []), tom = (r, c) => op.tons ? op.tons(r, c) || '' : '';
  const th = cab.map((c, i) => `<th scope="col"${i ? ' class="num"' : ''}>${c}</th>`).join('');
  const tb = linhas.map((l, r) => `<tr${sub.has(r) ? ' class="dre-l-subtotal"' : dest.has(r) ? ' class="cmp-destaque"' : ''}><th scope="row"${rec.has(r) ? ' style="padding-left:22px;font-weight:400"' : sub.has(r) || dest.has(r) ? ' style="font-weight:650"' : ' style="font-weight:400"'}>${esc(l[0])}</th>${l.slice(1).map((v, c) => { const t = tom(r, c + 1); return `<td class="num${t ? ' ' + t : ''}"${sub.has(r) || dest.has(r) ? ` style="font-weight:650${t ? '' : ';color:var(--text)'}"` : ''}>${esc(v)}</td>`; }).join('')}</tr>`).join('');
  return `<div class="table-scroll"><table class="tabela-controle cmp-tabela">${op.legenda ? `<caption>${esc(op.legenda)}</caption>` : ''}<thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`;
}
const cmpCabAno = (p, M, cls) => { const ms = cls ? p.mesesCls : p.meses; return `${p.ano}${ms.length < 12 ? `<br><small>${esc(cmpMesesTexto(ms))}</small>` : ''}`; };
function cmpDetalheTabela(M, linha, titulo) {
  const anos = M.porAno.filter(p => p.cls.length), idx = anos.map(p => M.porAno.indexOf(p)), itens = M.detalhes[linha] || [];
  const mostrar = itens.slice(0, 10), resto = itens.slice(10);
  const linhas = mostrar.map(it => [it.rotulo, ...idx.map(i => cmpFmt(it.valores[i]))]);
  const total = idx.map(i => M.porAno[i].pct[linha]);
  // Grupo sem lançamento em nenhum ano: sem tabela (quem chama lista o nome numa linha só).
  if (itens.every(it => idx.every(i => !it.valores[i])) && total.every(v => !v)) return '';
  const outros = idx.map((i, k) => { const s = mostrar.reduce((t, it) => t + (it.valores[i] || 0), 0); const o = (total[k] ?? 0) - s; return Math.abs(o) >= .05 ? o : 0; });
  if (resto.length || outros.some(o => Math.abs(o) >= .3)) linhas.push([`Outros${resto.length ? ` (${resto.length})` : ''}`, ...outros.map(o => cmpFmt(o))]);
  linhas.push([`Total ${titulo.toLowerCase()}`, ...total.map(v => cmpFmt(v))]);
  return cmpTabela(['% das vendas', ...anos.map(p => cmpCabAno(p, M, true))], linhas, { subtotais: [linhas.length - 1] });
}
// O "·" explicado uma vez por seção, e não em cada mini-tabela.
const CMP_NOTA_PONTO = '<p class="hint">· = nenhum lançamento na conta naquele ano.</p>';
// As mini-tabelas de uma seção: só os grupos com lançamento; os zerados numa linha no fim.
function cmpDetalheGrupos(M, chaves, comTitulo = true) {
  const vazios = [], html = chaves.map(k => { const nome = CMP_DETALHES.find(d => d[0] === k)[1], t = cmpDetalheTabela(M, k, nome); if (!t) { vazios.push(nome); return ''; } return (comTitulo ? `<h3 class="cmp-h3">${esc(nome)}</h3>` : '') + t; }).join('');
  return html + (vazios.length ? `<p class="hint">Sem lançamento em nenhum ano: ${esc(vazios.join(', '))}.</p>` : '');
}

// ── A leitura em texto, dos próprios números ────────────────────────────────
function cmpLeitura(M) {
  const P = M.porAno, D = P.filter(p => p.cls.length), R = D[D.length - 1], ant = D.slice(0, -1);
  const pontos = [], limites = [], conferir = [], passos = [];
  const mesRef = CMP_MES[M.refMes - 1];
  // "2026 até set" no ano de referência pela metade; "jun a dez de 2021" num ano com meses sem plano de contas
  const txtAno = p => p.ano === M.refAno && M.refMes < 12 ? `${p.ano} até ${mesRef}` : String(p.ano);
  const txtAnoCls = p => p.mesesCls.length === 12 ? String(p.ano) : p.ano === M.refAno && p.mesesCls[0] === 1 && p.mesesCls.length === M.refMes ? `${p.ano} até ${mesRef}` : `${cmpMesesTexto(p.mesesCls)} de ${p.ano}`;
  const pc = (v, d = 0) => cmpFmt(v, d) + '%';
  const faixa = (vs, d = 0) => { const a = pc(Math.min(...vs), d), b = pc(Math.max(...vs), d); return a === b ? a : `de ${a} a ${b}`; };
  const media = vs => vs.reduce((t, v) => t + v, 0) / vs.length;
  const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);
  const linhaCresc = ch => M.crescimento.linhas.find(l => l.chave === ch);
  const rotPar = i => { const pr = M.crescimento.pares[i]; return pr.a1 === M.refAno && M.refMes < 12 ? `${pr.a1} até ${mesRef}` : String(pr.a1); };
  // 1. Vendas
  const cheios = P.filter(p => p.meses.length === 12);
  if (cheios.length >= 2) {
    const a = cheios[0], b = cheios[cheios.length - 1], g = b.vendas / a.vendas * 100 - 100;
    let t = `<b>As vendas ${g >= 0 ? 'cresceram' : 'caíram'} ${pc(Math.abs(g))} de ${a.ano} a ${b.ano}</b> (anos inteiros)`;
    const eleicoes = P.filter(p => p.vendas > 0 && p.politico / p.vendas * 100 >= 3);
    if (eleicoes.length) {
      t += `. Material político pesou ${eleicoes.map(p => `${pc(p.politico / p.vendas * 100)} das vendas em ${txtAno(p)}`).join(' e ')}`;
      const sp = linhaCresc('vendasSemPolitico'), ult = sp ? sp.valores.map((v, i) => v ? `${cmpVar(v.valor, 0)} em ${rotPar(i)}` : null).filter(Boolean).slice(-3) : [];
      if (ult.length) t += `; sem ele, as vendas variaram ${ult.join(', ')}`;
    }
    pontos.push(t + '.');
  }
  if (D.length >= 2) {
    const a = D[0], iR = P.indexOf(R);
    // Ano de referência pela metade: o veredito vem do ano anterior nos mesmos meses; o ano anterior inteiro fica como contexto.
    const MP = R.mesesCls.length < 12 && M.mesmoPeriodo && M.mesmoPeriodo.ano === R.ano - 1 ? M.mesmoPeriodo : null;
    const AI = MP ? P.find(p => p.ano === MP.ano && p.cls.length) : null;
    const txtMP = MP ? `nos mesmos meses de ${MP.ano} (${cmpMesesTexto(MP.mesesCls)})` : '';
    const ctxAno = p => p.mesesCls.length === 12 ? `no ano inteiro de ${p.ano}` : `em ${txtAnoCls(p)}`;
    // 2. Margem de contribuição e custos variáveis
    const topVar = (M.detalhes.variaveis || []).map(it => ({ rot: it.rotulo, v: it.valores[iR] })).filter(x => cmpNum(x.v) && !/renomeadas|sem subgrupo/i.test(x.rot)).sort((x, y) => y.v - x.v).slice(0, 3).map(x => x.rot.toLowerCase());
    const bm = MP || a, dm = R.pct.margemContribuicao - bm.pct.margemContribuicao, mesmaVar = pc(bm.pct.variaveis) === pc(R.pct.variaveis);
    const verboM = dm > 1 ? 'melhorou' : dm < -1 ? 'piorou' : 'ficou estável', txtVar = `Os custos variáveis ${mesmaVar ? `ficaram em ${pc(R.pct.variaveis)}` : `foram de ${pc(bm.pct.variaveis)} para ${pc(R.pct.variaveis)}`} das vendas${MP ? ' nos mesmos meses' : ''}${topVar.length ? `; os maiores hoje são ${topVar.join(', ')}` : ''}.`;
    pontos.push(MP ? `<b>A margem de contribuição ${verboM}</b>: ${pc(R.pct.margemContribuicao)} das vendas em ${txtAno(R)}; ${txtMP} eram ${pc(MP.pct.margemContribuicao)}. ${maiuscula(ctxAno(AI))}, ${pc(AI.pct.margemContribuicao)}${a !== AI ? `; em ${txtAnoCls(a)}, ${pc(a.pct.margemContribuicao)}` : ''}. ${txtVar}`
      : `<b>A margem de contribuição ${verboM}</b>: ${pc(a.pct.margemContribuicao)} das vendas em ${txtAnoCls(a)} e ${pc(R.pct.margemContribuicao)} em ${txtAno(R)}. ${txtVar}`);
    // 3. Despesas fixas e pessoal, contra o ano de estrutura mais enxuta
    const base = ant.reduce((m, p) => !m || p.pct.fixas < m.pct.fixas ? p : m, null);
    if (base) {
      const pes = linhaCresc('pessoal'), ven = linhaCresc('vendas'), acima = [];
      if (pes && ven) pes.valores.forEach((v, i) => { const w = ven.valores[i]; if (v && w && v.valor > w.valor + 1) acima.push(`${rotPar(i)} (${cmpVar(v.valor, 0)} contra ${cmpVar(w.valor, 0)})`); });
      const df = R.pct.fixas - (MP || base).pct.fixas, recorde = R.pct.fixas < base.pct.fixas, verboF = df > 1 ? 'subiram' : df < -1 ? 'caíram' : 'ficaram estáveis';
      const txtAcima = acima.length ? `; a folha cresceu mais que as vendas em ${acima.join(', ')}` : '';
      if (MP) {
        const enxuto = base === AI ? `, ${recorde ? 'até então o ano mais enxuto' : 'o ano mais enxuto'}` : `; ${recorde ? 'até então, o ano mais enxuto foi' : 'o ano mais enxuto foi'} ${txtAnoCls(base)}, com ${pc(base.pct.fixas)}`;
        pontos.push(`<b>As despesas fixas ${verboF}</b>: ${pc(R.pct.fixas)} das vendas em ${txtAno(R)}; ${txtMP} eram ${pc(MP.pct.fixas)}. ${maiuscula(ctxAno(AI))}, ${pc(AI.pct.fixas)}${enxuto}. Pessoal foi de ${pc(MP.pct.pessoal)} para ${pc(R.pct.pessoal)} nos mesmos meses${txtAcima}.`);
      } else pontos.push(`<b>As despesas fixas ${verboF}</b>: ${pc(base.pct.fixas)} das vendas em ${txtAnoCls(base)}, ${recorde ? 'até então o ano mais enxuto' : 'o ano mais enxuto'}, e ${pc(R.pct.fixas)} em ${txtAno(R)}. Pessoal foi de ${pc(base.pct.pessoal)} para ${pc(R.pct.pessoal)}${txtAcima}.`);
    }
    // 4. Resultado e ponto de equilíbrio, contra o melhor ano
    const melhor = ant.reduce((m, p) => !m || p.pct.resultado > m.pct.resultado ? p : m, null);
    if (melhor) {
      const dr = R.pct.resultado - (MP || melhor).pct.resultado, recorde = R.pct.resultado > melhor.pct.resultado, verboR = dr < -1 ? 'caiu' : dr > 1 ? 'subiu' : 'ficou estável';
      const txtPE = `O ponto de equilíbrio está em ${pc(R.pct.pe)} das vendas`, txtMetade = R.pct.pe >= 50 ? ': mais da metade do que se vende serve só para pagar a estrutura fixa' : '';
      if (MP) {
        const melhorTxt = melhor === AI ? `, ${recorde ? 'até então o melhor ano' : 'o melhor ano'}` : `; ${recorde ? 'até então, o melhor ano foi' : 'o melhor ano foi'} ${txtAnoCls(melhor)}, com ${pc(melhor.pct.resultado)}`;
        pontos.push(`<b>O resultado antes dos sócios ${verboR}</b>: ${pc(R.pct.resultado)} das vendas em ${txtAno(R)}; ${txtMP} eram ${pc(MP.pct.resultado)}. ${maiuscula(ctxAno(AI))}, ${pc(AI.pct.resultado)}${melhorTxt}. ${txtPE}${cmpNum(MP.pct.pe) ? ` (${pc(MP.pct.pe)} nos mesmos meses de ${MP.ano})` : ''}${txtMetade}.`);
      } else pontos.push(`<b>O resultado antes dos sócios ${verboR}</b>: ${pc(melhor.pct.resultado)} das vendas em ${txtAnoCls(melhor)}, ${recorde ? 'até então o melhor ano' : 'o melhor ano'}, e ${pc(R.pct.resultado)} em ${txtAno(R)}. ${txtPE}${cmpNum(melhor.pct.pe) ? ` (era ${pc(melhor.pct.pe)})` : ''}${txtMetade}.`);
    }
    // 5. Sócios
    const sr = D.map(p => p.pct.sociosResultado).filter(cmpNum), sv = D.map(p => p.pct.socios).filter(cmpNum);
    if (sr.length) pontos.push(`<b>Retiradas e arrendamento levam ${faixa(sr)} do resultado</b> (${faixa(sv)} das vendas); em ${txtAno(R)}, ${pc(R.pct.sociosResultado)}.`);
    // 6. Dívida
    const antDiv = ant.map(p => p.pct.dividas).filter(cmpNum), antEmp = ant.map(p => p.pct.emprestimos).filter(cmpNum);
    const mDiv = antDiv.length ? media(antDiv) : 0, mEmp = antEmp.length ? media(antEmp) : 0;
    const topEmp = (M.detalhes.emprestimos || []).map(it => ({ rot: it.rotulo, v: it.valores[iR] })).filter(x => cmpNum(x.v) && x.v >= .5).sort((x, y) => y.v - x.v).slice(0, 2);
    const antes = antDiv.length ? (pc(Math.min(...antDiv)) === pc(Math.max(...antDiv)) ? `em torno de ${pc(antDiv[0])}` : `entre ${pc(Math.min(...antDiv))} e ${pc(Math.max(...antDiv))}`) : '';
    if (R.pct.emprestimos >= Math.max(5, mEmp * 2) && R.pct.dividas >= Math.max(5, mDiv * 1.5)) {
      pontos.push(`<b>Em ${txtAno(R)}, a empresa passou a girar dívida</b>: entram empréstimos de ${pc(R.pct.emprestimos)} das vendas${topEmp.length ? ` (${topEmp.map(x => `${esc(x.rot)} ${cmpFmt(x.v)}%`).join(' e ')})` : ''} e saem ${pc(R.pct.dividas)} em pagamento de dívidas.${antes ? ` Antes, as dívidas pagas ficavam ${antes}.` : ''}`);
      passos.push(`<b>Dívida de ${R.ano}</b>: levantar o custo da antecipação de recebíveis e dos empréstimos e montar um plano para reduzir o giro de dívida${M.saz.length ? ', usando os meses mais fortes do ano' : ''}.`);
    } else if (cmpNum(R.pct.dividas)) pontos.push(`<b>Dívidas pagas</b>: ${pc(R.pct.dividas)} das vendas em ${txtAno(R)}${antes ? ` (antes, ${antes})` : ''}; empréstimos recebidos: ${pc(R.pct.emprestimos)}.`);
    // 7. Investimentos
    const altos = D.filter(p => p.pct.investimentos >= 8);
    if (altos.length) pontos.push(`<b>Investimentos pesaram ${altos.map(p => `${pc(p.pct.investimentos)} das vendas em ${txtAno(p)}`).join(' e ')}</b> (máquinas, veículos e parcelas de financiamento de equipamentos); em ${txtAno(R)}, ${pc(R.pct.investimentos)}.`);
    // 8. Sem detalhamento
    const antSd = ant.map(p => p.pct.semDetalhamento).filter(cmpNum), mSd = antSd.length ? media(antSd) : null;
    if (mSd != null && R.pct.semDetalhamento > mSd + 1) pontos.push(`<b>Saídas sem detalhamento cresceram</b>: ${pc(R.pct.semDetalhamento, 1)} das vendas em ${txtAno(R)}, contra cerca de ${pc(mSd)} nos anos anteriores.`);
    // Próximos passos de estrutura
    const mediaPes = ant.slice(-3).map(p => p.pct.pessoal).filter(cmpNum);
    if (mediaPes.length && R.pct.pessoal > media(mediaPes) + 2) passos.unshift(`<b>Pessoal</b>: definir um teto em % das vendas e acompanhar mês a mês. Nos anos anteriores a média foi ${pc(media(mediaPes))}; em ${txtAno(R)} está em ${pc(R.pct.pessoal)}.`);
    if (R.pct.pe >= 50) passos.push(`<b>Ponto de equilíbrio</b> em ${pc(R.pct.pe)} das vendas: acompanhar em Preço e equilíbrio e rever a estrutura fixa antes dos meses mais fracos do ano.`);
  }
  // 9. Sazonalidade e o ano de referência mês a mês
  const sz = M.saz.filter(Boolean);
  if (sz.length) {
    const ord = [...sz].sort((a, b) => b.indice - a.indice), fortes = ord.slice(0, 2).sort((a, b) => a.mes - b.mes), fraco = ord[ord.length - 1];
    let t = `<b>${maiuscula(fortes.map(s => CMP_MES[s.mes - 1]).join(' e '))} são os meses mais fortes</b> (${fortes.map(s => Math.round(s.indice)).join(' e ')}, sendo 100 o mês médio); ${CMP_MES[fraco.mes - 1]} é o mais fraco (${Math.round(fraco.indice)}).`;
    const mm = M.mesAMes.filter(x => cmpNum(x.valor));
    if (mm.length >= 3) {
      const acima = mm.filter(x => x.valor > 1), abaixo = mm.filter(x => x.valor < -1).sort((a, b) => a.valor - b.valor);
      const pior = abaixo.length ? ` (o pior, ${CMP_MES[abaixo[0].mes - 1]}: ${cmpVar(abaixo[0].valor, 0)})` : '';
      t += acima.length === mm.length ? ` Em ${M.refAno}, os ${mm.length} meses completos ficaram acima do mesmo mês de ${M.refAno - 1}.`
        : abaixo.length === mm.length ? ` Em ${M.refAno}, os ${mm.length} meses completos ficaram abaixo do mesmo mês de ${M.refAno - 1}${pior}.`
        : ` Em ${M.refAno}, ${acima.length} ${acima.length === 1 ? 'mês ficou' : 'meses ficaram'} acima do mesmo mês de ${M.refAno - 1} e ${abaixo.length} abaixo${pior}.`;
    }
    pontos.push(t);
  }
  // Limites
  const semConta = M.meses.filter(x => x.fechado && !x.classificado);
  if (semConta.length) { const ps = semConta.map(x => x.pctSemConta).filter(cmpNum); limites.push(`<b>${cmpFaixasMeses(semConta).join(', ')}</b>: ${faixa(ps)} das saídas foram lançadas no Mubisys sem plano de contas. Vendas e caixa desses meses valem; custos e despesas ficam de fora da comparação.`); }
  const abertos = M.meses.filter(x => !x.fechado && x.ano * 12 + x.mes >= M.refAno * 12 + M.refMes);
  if (abertos.length) limites.push(`<b>${abertos.map(x => x.label).join(', ')}</b> fica fora (mês em andamento ou coletado pela metade).`);
  if (M.semOS) { const v = M.semOS.valores.filter(cmpNum); if (v.length && Math.max(...v) >= 10) limites.push(`<b>Produtos</b>: ${faixa(v)} das vendas foram recebidas sem O.S. completa no Mubisys, então o mix de produtos mostra só uma parte.`); }
  // Material político: de onde vem e o que o marcador muda
  const camp = cmpUI.campanhas, osMeses = M.pelasOS.length ? cmpFaixasMeses(M.pelasOS).join(', ') : '';
  const basePol = '<b>Material político</b>: vem da conta 1.5 e do produto "Material Político" de cada O.S.';
  limites.push(camp ? (osMeses ? `${basePol}; em ${osMeses}, também do dinheiro das O.S. marcadas nas campanhas de Política do Painel (fica o maior dos dois). Antes disso, o DRE não guardou a O.S. de cada recebimento.` : `${basePol}; as campanhas de Política do Painel só entram nos meses com a trilha dos recebimentos.`)
    : cmpUI.campErro ? `${basePol}; as campanhas do Painel não puderam ser lidas agora (${esc(cmpUI.campErro)}), então nos meses de eleição recentes o valor pode ficar abaixo do real.` : `${basePol}; as campanhas do Painel ainda estão sendo lidas.`);
  if (M.semPolitica) limites.push('<b>Sem material político</b>: as vendas dos painéis de venda saem sem ele; a DRE, as margens e as despesas continuam com ele, porque o custo do material político se mistura às outras compras.');
  limites.push('Base caixa: compra paga no mês não é o custo do que foi vendido, e estoque não entra. Contas renomeadas pelo robô entram na linha pelo nome.');
  // Pontos a conferir (regras automáticas)
  if (R) {
    const iR = P.indexOf(R), anteriores = P.filter(p => p.ano < R.ano && p.cls.length).slice(-3);
    // conta de despesa que aparecia todo ano e sumiu no ano de referência
    if (anteriores.length === 3 && R.mesesCls.length >= 6) {
      const presenca = p => { const m = new Map(); for (const x of p.cls) for (const c of x.reg.cells || []) { const code = String(c?.code || ''); if (!/^2\.\d+\.\d+$/.test(code) || !Number(c.value)) continue; const k = cmpNorm(c.name || code); const e = m.get(k) || { nome: c.name || code, meses: new Set() }; e.meses.add(x.mes); m.set(k, e); } return m; };
      const pR = presenca(R), pa = anteriores.map(presenca);
      for (const [k, e] of pa[pa.length - 1]) if (pa.every(m => (m.get(k)?.meses.size || 0) >= 6) && !pR.has(k) && !/^\d/.test(e.nome)) conferir.push(`<b>${esc(e.nome)}</b> aparecia em todos os anos anteriores e não aparece em ${txtAno(R)}: conferir onde está sendo lançado.`);
    }
    // o mesmo nome lançado em contas de grupos diferentes no ano de referência
    const grupos = new Map(); for (const x of R.cls) for (const c of x.reg.cells || []) { const code = String(c?.code || ''); if (!/^2\.\d+\.\d+$/.test(code) || !Number(c.value)) continue; const k = cmpNorm(c.name); if (!k || /^\d/.test(k)) continue; const e = grupos.get(k) || { nome: c.name, codes: new Set(), v: 0 }; e.codes.add(code); e.v += Number(c.value); grupos.set(k, e); }
    for (const e of grupos.values()) { const pais = new Set([...e.codes].map(c => c.split('.').slice(0, 2).join('.'))); if (pais.size >= 2 && R.vendasCls > 0 && e.v / R.vendasCls * 100 >= .5) conferir.push(`<b>${esc(e.nome)}</b> em ${txtAno(R)} está em ${pais.size} grupos de contas diferentes (${[...e.codes].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).join(', ')}), somando ${cmpFmt(e.v / R.vendasCls * 100)}% das vendas: conferir se há lançamento duplicado.`); }
    // devolução a cliente lançada como despesa administrativa
    const devol = (M.detalhes.administrativas || []).filter(it => /devolu/i.test(it.rotulo) && D.some(p => (it.valores[P.indexOf(p)] || 0) >= .2));
    for (const it of devol) conferir.push(`<b>${esc(it.rotulo)}</b> lançada em conta administrativa (${it.codes.join(', ')}): o certo é descontar da receita.`);
    // fatura de cartão sem os lançamentos de cada compra
    const fatura = (M.detalhes.semDetalhamento || []).find(it => it.codes.some(c => c.startsWith('2.13.52')));
    if (fatura && (fatura.valores[iR] || 0) >= 1) conferir.push(`<b>Fatura do cartão</b>: ${cmpFmt(fatura.valores[iR])}% das vendas em ${txtAno(R)} sem os lançamentos de cada compra. Lançar a fatura por despesa.`);
    // marketing lançado em conta de material
    const mkt = (M.detalhes.variaveis || []).filter(it => /ag[eê]ncia|instagram|v[ií]deo ?maker|patroc[ií]n|outdoor|r[aá]dio|panflet/i.test(it.rotulo) && !/papel|lona|vinil|mm\b|pvc|acm|chapa|manta/i.test(it.rotulo));
    for (const it of mkt) conferir.push(`<b>${esc(it.rotulo)}</b> lançada em conta de material (${it.codes.join(', ')}): é marketing.`);
  }
  if (M.semOS) { const v = M.semOS.valores[M.semOS.valores.length - 1]; if (v >= 20) passos.push(`<b>O.S. nos recebimentos</b>: ${pc(v)} das vendas de ${M.prodAnos[M.prodAnos.length - 1]} entraram sem O.S. completa no título; informar a O.S. no Mubisys mostra de que produto veio a venda.`); }
  // ano de eleição sem material político (as eleições no Brasil são nos anos pares)
  const ult = P[P.length - 1], anterior = P.filter(p => p.ano % 2 === 0 && p.ano < ult.ano && p.vendas > 0 && p.politico / p.vendas * 100 >= 5).pop();
  if (ult.ano % 2 === 0 && anterior && ult.vendas > 0 && ult.politico / ult.vendas * 100 < 1) passos.push(`<b>Eleição de ${ult.ano}</b>: material político está em ${pc(ult.politico / ult.vendas * 100, 1)} das vendas até ${mesRef}; em ${anterior.ano} foi ${pc(anterior.politico / anterior.vendas * 100)}.`);
  return { pontos, limites, conferir, passos };
}

// ── A seção no Dashboard ────────────────────────────────────────────────────
function cmpChave() {
  const recente = state.records.reduce((m, r) => String(r?.atualizadoEm || '') > m ? String(r.atualizadoEm) : m, '');
  return [state.records.length, recente, state.periodo, typeof dfcHoje === 'function' ? dfcHoje() : '', cmpUI.semPolitica ? 'sem' : 'com', cmpUI.campanhas ? `c${cmpUI.campanhas.atualizadoEm || ''}:${cmpUI.campanhas.campanhas.length}` : '', cmpUI.campErro].join('|');
}
// As campanhas do Painel: uma leitura a cada 10 minutos, com ou sem erro (a tela redesenha
// ao chegar e não pode pedir de novo em laço). Sem elas, vale o produto e a conta 1.5.
function cmpCarregarCampanhas() {
  if (typeof api !== 'function' || cmpUI.campBusy || Date.now() - cmpUI.campEm < 600000) return;
  const seq = ++cmpUI.campSeq; cmpUI.campBusy = true; cmpUI.campEm = Date.now();
  Promise.resolve().then(() => api('indicadores', { fonte: 'campanhas' })).then(r => {
    if (seq !== cmpUI.campSeq) return;
    if (!r?.ok || r.fonte !== 'campanhas' || !Array.isArray(r.campanhas)) throw new Error(r?.erro || 'Fonte inválida.');
    cmpUI.campanhas = r; cmpUI.campErro = '';
  }).catch(e => {
    if (seq !== cmpUI.campSeq) return;
    const m = String(e?.message || e || '');
    // O servidor anterior a esta fase responde à fonte nova com "Fonte inválida" ou com o erro de período.
    cmpUI.campErro = /desconhecida|Fonte inválida|intervalo válido/i.test(m) ? 'o servidor ainda não tem a leitura das campanhas' : /abort/i.test(m) ? 'o servidor demorou a responder' : m || 'erro na leitura';
  }).finally(() => {
    if (seq !== cmpUI.campSeq) return;
    cmpUI.campBusy = false; cmpUI.campEm = Date.now();
    if (state.view === 'inicio' && typeof render === 'function' && cmpChave() !== cmpUI.chave) render();
  });
}
// Cartão da seção que lembra se a pessoa o abriu ou fechou: marcar o material político
// e a chegada das campanhas redesenham a tela.
function cmpCard(chave, titulo, html, aberto) {
  const open = chave in cmpUI.abertos ? cmpUI.abertos[chave] : aberto;
  return `<details class="card" id="secao-cmp-${chave}" data-cmp-sec="${chave}"${open ? ' open' : ''}><summary><h2 class="card-titulo">${esc(titulo)}</h2></summary><div class="card-body">${html}</div></details>`;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('toggle', ev => { const d = ev.target; if (d?.dataset?.cmpSec) cmpUI.abertos[d.dataset.cmpSec] = !!d.open; }, true);
  document.addEventListener('change', ev => {
    const t = ev.target; if (!t || typeof t.matches !== 'function' || !t.matches('[data-cmp-politica]')) return;
    cmpUI.semPolitica = !t.checked;
    try { localStorage.setItem(CMP_CHAVE_POLITICA, cmpUI.semPolitica ? '1' : '0'); } catch { /* sem armazenamento: vale só nesta visita */ }
    if (typeof render === 'function') { render(); document.querySelector?.('[data-cmp-politica]')?.focus?.(); }
  });
}
function renderComparativos() {
  if (typeof GX === 'undefined' || typeof DRESimples === 'undefined') return '';
  cmpCarregarCampanhas();
  const chave = cmpChave(); if (cmpUI.chave !== chave) { cmpUI.modelo = cmpModelo(); cmpUI.chave = chave; }
  const M = cmpUI.modelo;
  const topo = `<div class="section-heading" id="comparativos-anuais"><div><h2>Comparativos anuais</h2></div></div>`;
  if (!M || !M.porAno.length) return topo + card('Comparativos anuais', '<p class="hint">Ainda não há meses completos para comparar.</p>', true);
  const P = M.porAno, D = P.filter(p => p.cls.length), iD = D.map(p => P.indexOf(p));
  const ateTxt = M.refMes < 12 ? `janeiro a ${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][M.refMes - 1]}` : 'ano inteiro';
  const intro = `<p class="hint">Os anos lado a lado, das mesmas linhas da DRE de caixa, em % das vendas, crescimento e índice. Ano de referência: <b>${M.refAno}</b>, até ${CMP_MES[M.refMes - 1]} (o último mês completo até o mês escolhido na barra). Crescimento sempre compara os mesmos meses; custos e despesas só dos meses com plano de contas. Os valores em reais ficam em "Ver os valores" e nas outras telas.</p>`;
  const sem = M.semPolitica, P0 = P.filter(p => p.vendas > 0 && p.politico / p.vendas >= .005);
  const fonteTxt = cmpUI.campanhas ? `Conta 1.5, produto "Material Político" das O.S. e as O.S. das campanhas de Política do Painel${M.pelasOS.length ? ` (${cmpFaixasMeses(M.pelasOS).join(', ')})` : ''}.`
    : cmpUI.campErro ? `Conta 1.5 e produto "Material Político" das O.S. (as campanhas do Painel não puderam ser lidas: ${cmpUI.campErro}).` : 'Conta 1.5 e produto "Material Político" das O.S.; lendo as campanhas do Painel.';
  const marcador = `<div class="cmp-marcador"><label><input type="checkbox" data-cmp-politica${sem ? '' : ' checked'}> Incluir material político (eleições)</label>`
    + `<span>${P0.length ? `Material político: ${P0.map(p => `${p.ano} ${cmpFmt(p.politico / p.vendas * 100)}%`).join(' · ')} das vendas.` : 'Nenhum material político encontrado.'} ${esc(fonteTxt)}${sem ? ' Desmarcado: os painéis de venda saem sem ele; a DRE e as margens continuam com ele.' : ''}</span></div>`;
  // 1. Vendas
  const ix = M.indice;
  const gIdx = ix.length ? cmpGrafColunas(ix.map(i => ({ rotulo: String(i.ano), topo: String(Math.round(i.valor)), partes: [{ valor: i.semPolitico, cor: 'entrada' }, { valor: i.extra, cor: 'serie-2' }], dica: `${i.ano} · ${ateTxt}\nÍndice ${Math.round(i.valor)}${i.extra >= .5 ? ` (eleição +${Math.round(i.extra)})` : ''}\nVendas${sem ? ' sem material político' : ''}: ${money(i.vendas - (sem ? i.politico : 0))}${i.politico > 0 ? `\nMaterial político: ${money(i.politico)}${sem ? ' (fora)' : ''}` : ''}` })),
    { H: 200, leitura: `Vendas de ${ateTxt} de cada ano${sem ? ', sem o material político' : ''}, em índice (${ix[0].ano} = 100): ${ix.map(i => `${i.ano} ${Math.round(i.valor)}`).join(', ')}.`, legenda: sem ? [{ rotulo: 'Vendas sem material político', cor: 'entrada' }] : [{ rotulo: 'Vendas sem material político', cor: 'entrada' }, { rotulo: 'Material político (eleição)', cor: 'serie-2' }],
      tabela: GX.tabela(['Ano', 'Índice', 'Sem material político', 'Vendas', 'Material político'], ix.map(i => [String(i.ano), String(Math.round(i.valor)), String(Math.round(i.semPolitico)), money(i.vendas), money(i.politico)]), [1, 2, 3, 4], (r, c) => c === 3 && ix[r].vendas > 0 || c === 4 && ix[r].politico > 0 ? 'tom-entra' : '') }) : GX.aviso('cmp-colunas', 'Não apurado: nenhum ano com todos os meses do período.');
  const cv = M.crescimento.linhas.find(l => l.chave === 'vendas'), cs = M.crescimento.linhas.find(l => l.chave === 'vendasSemPolitico');
  const tCresc = cmpTabela(['Crescimento das vendas', 'Vendas', 'Sem material político'], M.crescimento.pares.map((pr, i) => [`${pr.a1} × ${pr.a0}${pr.meses.length && pr.meses.length < 12 ? ` (${cmpMesesTexto(pr.meses)})` : ''}`, cmpVarSeta(cv.valores[i]?.valor), cmpVarSeta(cs.valores[i]?.valor)]), { legenda: 'Contra os mesmos meses do ano anterior', tons: (r, c) => cmpTomVar(1, (c === 1 ? cv : cs).valores[r]?.valor) });
  const gSaz = cmpFaixaSazonal(M.saz, { leitura: 'Sazonalidade: cada mês contra a média mensal do ano, nos anos inteiros.', tabela: GX.tabela(['Mês', 'Índice', 'Menor', 'Maior'], M.saz.filter(Boolean).map(s => [CMP_MES[s.mes - 1], String(Math.round(s.indice)), String(Math.round(s.min)), String(Math.round(s.max))]), [1, 2, 3]) });
  const gMes = cmpGrafVariacao(M.mesAMes.map(x => ({ rotulo: CMP_MES[x.mes - 1], valor: x.valor, dica: `${CMP_MES[x.mes - 1]}/${M.refAno} contra ${CMP_MES[x.mes - 1]}/${M.refAno - 1}` })), { leitura: `${M.refAno} mês a mês contra o mesmo mês de ${M.refAno - 1}.`, tabela: GX.tabela(['Mês', `${M.refAno} × ${M.refAno - 1}`], M.mesAMes.map(x => [CMP_MES[x.mes - 1], cmpNum(x.valor) ? cmpVar(x.valor) : 'sem mês completo']), [1]) });
  const sec1 = cmpCard('vendas', '1. Vendas', `<div class="graficos-controle">${painelGrafico(`Vendas de ${ateTxt}${sem ? ' sem material político' : ''}, índice (${ix[0]?.ano ?? ''} = 100)`, 'Os mesmos meses em todos os anos; o ano sem esses meses no Mubisys fica de fora.', gIdx)}${painelGrafico('Crescimento das vendas', 'Com e sem material político (anos de eleição).', tCresc)}</div>`
    + `<div class="graficos-controle">${painelGrafico('Sazonalidade', `Cada mês contra a média mensal do ano (100 = mês médio), nos anos inteiros${sem ? ', sem o material político' : ''}.`, gSaz)}${painelGrafico(`${M.refAno} mês a mês`, `Contra o mesmo mês de ${M.refAno - 1}${sem ? ', sem o material político' : ''}.`, gMes)}</div>`, true);
  // 2. Receita
  const tMix = cmpTabela(['% das vendas', ...P.map(p => cmpCabAno(p, M, false))], M.mix.map(l => [l.rotulo, ...l.valores.map(v => cmpFmt(v))]), { destaques: M.mix.map((l, i) => l.politico ? i : -1).filter(i => i >= 0), legenda: sem ? '% das vendas sem material político' : '' });
  const tEnt = cmpTabela(['% das vendas', ...D.map(p => cmpCabAno(p, M, true))], [
    ['Rendimentos (aluguel e juros recebidos)', ...D.map(p => cmpFmt(p.pct.receitasFinanceiras))], ['Empréstimos recebidos', ...D.map(p => cmpFmt(p.pct.emprestimos))], ['Recebimentos sem conta no Mubisys', ...D.map(p => cmpFmt(p.pct.outrasEntradas))],
  ], { destaques: [1] });
  const extrasProd = [M.produtoPolitico, M.semOS].filter(Boolean);
  const tProd = M.produtos.length ? cmpTabela(['% das vendas', ...M.prodAnos.map(a => a === M.refAno && M.refMes < 12 ? `${a}<br><small>jan a ${CMP_MES[M.refMes - 1]}</small>` : String(a))], [...M.produtos, ...extrasProd].map(l => [l.rotulo, ...l.valores.map(v => cmpFmt(v))]), { destaques: extrasProd.map((_, i) => M.produtos.length + i), legenda: `${sem ? '% das vendas sem material político' : '% das vendas'} · rateio do recebido pelos itens das O.S.` }) : '<p class="hint">Sem produtos nas O.S. dos recebimentos.</p>';
  const sec2 = cmpCard('receita', '2. De onde vem a receita', `<h3 class="cmp-h3">Mix das vendas</h3>${tMix}<h3 class="cmp-h3">Entradas que não são venda</h3>${tEnt}<h3 class="cmp-h3">Produtos mais vendidos</h3>${tProd}`, false);
  // 3. DRE ano a ano; com o ano de referência pela metade, o anterior nos mesmos meses vem logo antes dele.
  const MP = M.mesmoPeriodo && D.length && D[D.length - 1].ano === M.refAno ? M.mesmoPeriodo : null;
  const C3 = MP ? [...D.slice(0, -1), MP, D[D.length - 1]] : D;
  const L = k => C3.map(p => cmpFmt(p.pct[k]));
  const dreLinhas = [
    ['Receita bruta de vendas', ...C3.map(() => '100,0')], ['dos quais, material político', ...C3.map(p => cmpFmt(p.vendasCls > 0 ? p.politicoCls / p.vendasCls * 100 : null))], ['(−) Simples (DAS e DARF), ISS e devoluções', ...L('deducoes')], ['(=) Receita líquida', ...L('receitaLiquida')], ['(−) Custos variáveis', ...L('variaveis')], ['(=) Margem de contribuição', ...L('margemContribuicao')],
    ['(−) Despesas fixas', ...L('fixas')], ['Pessoal', ...L('pessoal')], ['Administrativas e terceiros', ...L('administrativas')], ['Ocupação e utilidades', ...L('ocupacao')], ['Veículos', ...L('veiculos')], ['Marketing', ...L('marketing')], ['Taxas e IPTU', ...L('taxas')], ['Saídas sem linha na DRE', ...L('fixasOutras')],
    ['(=) Resultado operacional', ...L('ebitda')], ['(+/−) Financeiro (juros, tarifas e rendimentos)', ...C3.map(p => cmpFmt(p.pct.receitasFinanceiras - p.pct.despesasFinanceiras))], ['(=) Resultado antes dos sócios', ...L('resultado')], ['Ponto de equilíbrio (vendas necessárias)', ...L('pe')],
    ['(−) Retiradas e arrendamento (sócios)', ...L('socios')], ['(−) Investimentos e parcelas de ativos', ...L('investimentos')], ['(−) Dívidas pagas', ...L('dividas')], ['(−) Saídas sem detalhamento', ...L('semDetalhamento')], ['(+) Empréstimos recebidos', ...L('emprestimos')], ['(+) Outras entradas', ...L('outrasEntradas')], ['(=) Variação do caixa', ...L('variacao')],
  ];
  const sec3 = cmpCard('dre', '3. A DRE ano a ano (% das vendas)', (sem ? '<p class="hint">Esta parte continua com o material político: o custo dele está nas mesmas compras das outras vendas e não se separa.</p>' : '')
    + cmpTabela(['% das vendas', ...C3.map(p => cmpCabAno(p, M, true))], dreLinhas, { subtotais: [0, 3, 5, 14, 16, 24], destaques: [6, 17], recuo: [1, 7, 8, 9, 10, 11, 12, 13], legenda: '% das vendas · só os meses com plano de contas' })
    + (MP ? `<p class="hint">${MP.ano} ${esc(cmpMesesTexto(MP.mesesCls))}: o ano anterior só nos meses que ${M.refAno} já tem, para comparar sem a sazonalidade dos meses que faltam.</p>` : '')
    + '<p class="hint">Ponto de equilíbrio = despesas fixas ÷ margem de contribuição, em % das vendas. Valores arredondados.</p>', false);
  // 4. Margens e crescimento
  const rot = D.map(p => `${p.ano}${p.mesesCls.length < 12 ? '*' : ''}`);
  const parciais = D.filter(p => p.mesesCls.length < 12).map(p => `${p.ano}: ${cmpMesesTexto(p.mesesCls)}`), notaParcial = parciais.length ? ` * ${parciais.join('; ')}.` : '';
  const gLin = cmpGrafLinhas(rot, [{ rotulo: 'Margem de contribuição', cor: 'entrada', valores: D.map(p => p.pct.margemContribuicao) }, { rotulo: 'Despesas fixas', cor: 'saida', valores: D.map(p => p.pct.fixas) }, { rotulo: 'Resultado antes dos sócios', cor: 'resultado', valores: D.map(p => p.pct.resultado) }],
    { leitura: 'Margem de contribuição, despesas fixas e resultado antes dos sócios, em % das vendas, por ano.', tabela: GX.tabela(['Ano', 'Margem', 'Despesas fixas', 'Resultado antes dos sócios'], D.map((p, i) => [rot[i], cmpFmt(p.pct.margemContribuicao) + '%', cmpFmt(p.pct.fixas) + '%', cmpFmt(p.pct.resultado) + '%']), [1, 2, 3]) });
  const gCem = cmpGrafCem(D.map((p, i) => ({ rotulo: rot[i], valores: [p.pct.deducoes, p.pct.variaveis, p.pct.fixas, p.pct.ebitda] })), [{ rotulo: 'Simples e devoluções', cor: 'risco-1' }, { rotulo: 'Custos variáveis', cor: 'risco-2' }, { rotulo: 'Despesas fixas', cor: 'risco-3' }, { rotulo: 'Resultado operacional', cor: 'entrada' }],
    { leitura: 'Para onde vai cada R$ 100 vendidos, por ano.', tabela: GX.tabela(['Ano', 'Simples e devoluções', 'Custos variáveis', 'Despesas fixas', 'Resultado operacional'], D.map((p, i) => [rot[i], ...[p.pct.deducoes, p.pct.variaveis, p.pct.fixas, p.pct.ebitda].map(v => cmpFmt(v) + '%')]), [1, 2, 3, 4]) });
  const parRot = M.crescimento.pares.map(pr => `${pr.a1} × ${pr.a0}`);
  const tCr = cmpTabela(['Linha', ...parRot], M.crescimento.linhas.map(l => [l.rotulo, ...l.valores.map(v => cmpVarSeta(v?.valor))]), { tons: (r, c) => cmpTomVar(CMP_DIR[M.crescimento.linhas[r].chave] ?? 0, M.crescimento.linhas[r].valores[c - 1]?.valor), destaques: [M.crescimento.linhas.findIndex(l => l.chave === 'pessoal')], legenda: 'Contra os mesmos meses do ano anterior; custos e despesas só nos meses com plano de contas' });
  const sec4 = cmpCard('margens', '4. Margens, estrutura e crescimento', `<div class="graficos-controle">${painelGrafico('Margem, despesas fixas e resultado antes dos sócios', `% das vendas por ano.${notaParcial}`, gLin)}${painelGrafico('Para onde vai cada R$ 100 vendidos', `Resultado operacional = antes de juros, sócios, investimentos e dívidas.${notaParcial}`, gCem)}</div>${painelGrafico('Crescimento de cada linha', 'Contra o mesmo período do ano anterior.', tCr)}`, false);
  // 5 a 7. Detalhes
  const sec5 = cmpCard('variaveis', '5. Custos variáveis: o que acompanha a produção', CMP_NOTA_PONTO + cmpDetalheGrupos(M, ['variaveis'], false), false);
  const sec6 = cmpCard('fixas', '6. Despesas fixas', CMP_NOTA_PONTO + cmpDetalheGrupos(M, ['pessoal', 'administrativas', 'ocupacao', 'veiculos']), false);
  const gDiv = cmpGrafGrupos(D.map((p, i) => rot[i]), [{ rotulo: 'Empréstimos recebidos', cor: 'entrada', valores: D.map(p => p.pct.emprestimos) }, { rotulo: 'Dívidas pagas', cor: 'saida', valores: D.map(p => p.pct.dividas) }], { leitura: 'Empréstimos recebidos e dívidas pagas, em % das vendas, por ano.', tabela: GX.tabela(['Ano', 'Empréstimos recebidos', 'Dívidas pagas'], D.map((p, i) => [rot[i], cmpFmt(p.pct.emprestimos) + '%', cmpFmt(p.pct.dividas) + '%']), [1, 2]) });
  const sec7 = cmpCard('depois', '7. Depois do resultado: sócios, investimentos e dívida', painelGrafico('Empréstimos recebidos e dívidas pagas', `% das vendas por ano: o empréstimo em azul porque entrou, a dívida paga em vermelho porque saiu. Financiamento não é bom nem ruim por si.${notaParcial}`, gDiv)
    + CMP_NOTA_PONTO + cmpDetalheGrupos(M, ['socios', 'investimentos', 'dividas', 'emprestimos', 'semDetalhamento'])
    + `<p class="hint">Retiradas e arrendamento em % do resultado antes dos sócios: ${D.map((p, i) => `${rot[i]} ${cmpFmt(p.pct.sociosResultado)}%`).join(' · ')}.</p>`, false);
  // A explicação, embaixo
  const Lt = cmpLeitura(M), lista = xs => xs.length ? `<ul class="cmp-lista">${xs.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p class="hint">Nada a apontar.</p>';
  const expl = cmpCard('leitura', 'O que os números mostram', lista(Lt.pontos) + `<h3 class="cmp-h3">Limites desta comparação</h3>${lista(Lt.limites)}<h3 class="cmp-h3">Pontos a conferir no Mubisys</h3>${lista(Lt.conferir)}<h3 class="cmp-h3">Próximos passos sugeridos</h3>${lista(Lt.passos)}`, false);
  return topo + intro + marcador + sec1 + sec2 + sec3 + sec4 + sec5 + sec6 + sec7 + expl;
}
