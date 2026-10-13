import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
function ctx(){const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true}};vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','cfo-modelo.js','cfo.js','app.js','gestao.js','plano-contas.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);c.run=s=>vm.runInContext(s,c);c.run(`state.periodo='Set/2026';state.consulta='';state.tipo='todos';state.grupo='todos';state.records=['Ago','Set'].map((m,i)=>({label:m+'/2026',company:'Impresilk + Universo',basis:'Caixa',origem:'erp',qualidade:{ate:i?'2026-09-30':'2026-08-31',estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:[{code:'1',name:'Entradas',value:1000},{code:'2',name:'Saídas',value:500},{code:'2.5.1',name:'Copasa',value:0},{code:'2.5.3',name:'Cemig',value:100+i*50},...(i?[]:[{code:'2.8.1',name:'Serviço antigo',value:20}])]}));`);return c;}
test('catálogo reúne todos os meses, tipos e conta ausente no atual',()=>{const c=ctx();assert.equal(c.run('contextoPlano().catalogo.length'),5);assert.equal(c.run("planoValor(state.records[1],'2.8.1')"),null);assert.equal(c.run("planoValor(state.records[1],'2.5.1')"),0);});
test('água localiza Copasa e energia localiza Cemig sem criar registros',()=>{const c=ctx();assert.equal(c.run("state.consulta='água';contextoPlano().rows[0].name"),'Copasa');assert.equal(c.run("state.consulta='energia';contextoPlano().rows[0].name"),'Cemig');assert.equal(c.run('state.records[0].cells.length'),5);});
test('seleção respeita fronteiras de código e todos os filtros',()=>{const c=ctx();assert.equal(c.run("state.contaSelecionada='2.5';contextoPlano().rows.length"),2);assert.equal(c.run("state.tipo='1';contextoPlano().rows.length"),0);});
test('comparação mês a mês preserva zero, ausência e mudança de empresa ou nome',()=>{const c=ctx();assert.equal(c.run("PlanoContas.comparacao(state.records[1],state.records[0],'2.5.3').delta"),50);assert.equal(c.run("PlanoContas.comparacao(state.records[1],state.records[0],'2.5.1').percentual"),null);assert.equal(c.run("state.records[1].company='Outra';PlanoContas.comparacao(state.records[1],state.records[0],'2.5.3').permitida"),false);c.run("state.records[1].company=state.records[0].company;state.records[1].cells[3].name='Outra conta'");assert.equal(c.run("PlanoContas.comparacao(state.records[1],state.records[0],'2.5.3').permitida"),false);});
test('CSV exporta 12 meses, nomes originais e critérios apenas da seleção',()=>{const c=ctx();c.run("state.consulta='cemig'");const rows=c.run('linhasCSVPlano(contextoPlano())');assert.equal(rows[6].length,17);assert.equal(rows[6][1],'Código no Mubisys');assert.equal(rows[7][12],'100,00');assert.equal(rows[7][13],'150,00');assert.equal(rows[7][5],'Não informado');assert.doesNotMatch(JSON.stringify(rows),/Copasa|Serviço antigo/);assert.equal(rows.length,23);});
test('cores de entradas e saídas preservam o sentido de estornos',()=>{const c=ctx();assert.equal(c.run("planoTom('1.2',100)"),'tom-entra');assert.equal(c.run("planoTom('2.5',100)"),'tom-sai');assert.equal(c.run("planoTom('2.5',-100)"),'tom-entra');assert.equal(c.run("planoTom('2.5',null)"),'');});

test('busca de água não confunde aguardando com água ou Copasa',()=>{const c=ctx();assert.equal(c.run("state.records[0].cells.push({code:'1.99',name:'Produtos aguardando classificação',value:10});state.consulta='água';contextoPlano().rows.length"),1);});

test('árvore reúne ascendentes da busca e não confunde prefixos de códigos',()=>{const c=ctx();const roots=c.run("PlanoContas.arvore([{code:'2',name:'Saídas'},{code:'2.5',name:'Fixas'},{code:'2.5.3',name:'Cemig'},{code:'2.50',name:'Outro'}],[{code:'2.5.3'}])");assert.equal(roots.length,1);assert.equal(roots[0].children[0].code,'2.5');assert.equal(roots[0].children[0].children[0].code,'2.5.3');});
test('dashboard compara o valor da conta, sem somar suas subcontas',()=>{const c=ctx();c.run("state.contaSelecionada='2';state.comparar='Ago/2026'");const html=c.run('dashboardPlano(contextoPlano())');assert.match(html,/500,00/);assert.doesNotMatch(html,/650,00/);assert.match(html,/ficou estável/);assert.match(html,/Composição do mês/);});
test('dashboard preserva ausência e bloqueia mudança de escopo',()=>{const c=ctx();c.run("state.contaSelecionada='2.8.1';state.comparar='Ago/2026'");let html=c.run('dashboardPlano(contextoPlano())');assert.match(html,/Não informado/);assert.match(html,/Abrir último registro: Ago\/2026/);c.run("state.contaSelecionada='2.5.3';state.records[1].company='Outra'");html=c.run('dashboardPlano(contextoPlano())');assert.match(html,/Não comparável/);assert.doesNotMatch(html,/aumentou/);});
test('atalhos só apontam para contas existentes e painel inicia recolhido por níveis',()=>{const c=ctx();const html=c.run('renderPlanoContas()');assert.match(html,/⚡/);assert.match(html,/💧/);assert.doesNotMatch(html,/👥/);assert.match(html,/class="plano-children" hidden/);assert.match(html,/📊 Dashboard/);assert.match(html,/📋 Mês a mês/);assert.doesNotMatch(html,/exportAccounts|Planilha da seleção|Planilha e comparativos/,'um só ↓ Planilha, o do topo (N25)');});
test('atalhos escolhem despesas principais, sem confundir aluguel recebido ou insumos de máquina',()=>{const c=ctx();c.run("state.records[1].cells.push({code:'1.3.1',name:'Aluguel',value:100},{code:'2.5.2',name:'Aluguel lote',value:500},{code:'2.6.3.1',name:'Materiais/insumos',value:200},{code:'2.12',name:'Materiais e Insumos',value:800},{code:'2.1.1',name:'Salário',value:null},{code:'2.1.4',name:'Salário',value:1000})");const html=c.run('atalhosPlano(contextoPlano())');assert.match(html,/data-plano-quick="2.5.2"/);assert.match(html,/data-plano-quick="2.12"/);assert.match(html,/data-plano-quick="2.1.4"/);assert.doesNotMatch(html,/data-plano-quick="1.3.1"|data-plano-quick="2.6.3.1"/);});

// ── Fase 12.5: planilha em árvore, total do ano e o ano anterior nos mesmos meses; chip Ano no Dashboard ──
const comAnos=c=>c.run(`state.records=[...state.records,...['Ago','Set'].map((m,i)=>({label:m+'/2025',company:'Impresilk + Universo',basis:'Caixa',origem:'erp',qualidade:{ate:i?'2025-09-30':'2025-08-31',estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:[{code:'1',name:'Entradas',value:800},{code:'2',name:'Saídas',value:400},{code:'2.5.3',name:'Cemig',value:100}]}))];dfcHoje=()=>'2026-10-12';`);
test('planilha em árvore: grupos de 1º nível abertos, filhos escondidos até abrir; ações de nível e tudo aberto na busca',()=>{
 const c=ctx();c.run("planoUI.matriz=null;planoUI.aba='planilha'");const h=c.run('tabelaPlano(contextoPlano())');
 assert.match(h,/<tr class="plano-linha nivel-1 saida" data-plano-linha="2" data-ancestrais="">/);
 assert.match(h,/data-plano-linha="2\.5\.3" data-ancestrais="2"><th/,'filho de 2 visível (2 aberto)');
 assert.match(h,/data-plano-ramo="2" aria-expanded="true"/);assert.match(h,/data-plano-matriz="tudo"/);assert.match(h,/data-plano-matriz="nada"/);
 c.run("planoUI.matriz=new Set()");assert.match(c.run('tabelaPlano(contextoPlano())'),/data-plano-linha="2\.5\.3" data-ancestrais="2" hidden/,'2 recolhido esconde a Cemig');
 c.run("state.consulta='cemig'");assert.doesNotMatch(c.run('tabelaPlano(contextoPlano())'),/ hidden>/,'busca abre tudo');
});
test('colunas do ano: total, ano anterior só nos meses completos nos dois anos (com o tom da conta) e a diferença em bom ou ruim',()=>{
 const c=ctx();comAnos(c);c.run("planoUI.matriz=new Set(['1','2'])");const h=c.run('tabelaPlano(contextoPlano())');
 assert.match(h,/Total 2026<\/th><th scope="col" class="num plano-ano">2026<small>Ago a Set<\/small><\/th><th scope="col" class="num plano-ano">2025<small>Ago a Set<\/small><\/th><th scope="col" class="num plano-ano">Δ 2026 × 2025<small>Ago a Set nos dois anos<\/small><\/th>/);
 // Cemig: 100 + 150 = 250 em 2026; 200 em 2025 nos mesmos meses: +25% de saída = ruim (vermelho); o ano anterior leva o tom da conta (v133)
 assert.match(h,/data-plano-linha="2\.5\.3"[\s\S]*?<td class="num plano-ano tom-sai">250,00<\/td><td class="num plano-ano tom-sai">250,00<\/td><td class="num plano-ano tom-sai"[^>]*>200,00<\/td><td class="num plano-ano delta-ruim"[^>]*>▲ 25,0%<\/td>/);
 // Entradas: 2.000 contra 1.600: +25% em azul
 const linha1=h.slice(h.indexOf('data-plano-linha="1"'),h.indexOf('</tr>',h.indexOf('data-plano-linha="1"')));
 assert.match(linha1,/<td class="num plano-ano tom-entra">2\.000,00<\/td><td class="num plano-ano tom-entra">2\.000,00<\/td><td class="num plano-ano tom-entra"[^>]*>1\.600,00<\/td><td class="num plano-ano delta-bom"[^>]*>▲ 25,0%<\/td>/,'entradas subiram: azul, com seta (C11)');
 const sem=ctx();assert.match(sem.run('tabelaPlano(contextoPlano())'),/sem meses completos em 2026 e 2025 para comparar/);
});
test('chip Ano no Plano de contas: o Dashboard compara o ano com o anterior nos mesmos meses',()=>{
 const c=ctx();comAnos(c);c.run("state.anoTodo=true;state.contaSelecionada='2.5.3'");const h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/Ano 2026 contra 2025/);assert.match(h,/Aumentou R\$\s50,00 \(\+25,0%\) contra 2025 nos mesmos meses \(Ago a Set\)/);
 assert.match(c.run('ANO_TELAS.join()'),/detalhe/);
});
const J=(c,s)=>JSON.parse(c.run(`JSON.stringify(${s})`));
test('revisão 12.5: base diferente não compara; código 51+ com nomes diferentes não soma nem compara; conta nova não vira zero; centavos; planilha só na aba dela',()=>{
 // 2025 de outra empresa: nada a comparar
 const a=ctx();a.run(`state.records=[...state.records,...['Ago','Set'].map((m,i)=>({label:m+'/2025',company:'Impresilk',basis:'Caixa',origem:'erp',qualidade:{ate:i?'2025-09-30':'2025-08-31',estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:[{code:'1',name:'Entradas',value:800},{code:'2',name:'Saídas',value:400},{code:'2.5.3',name:'Cemig',value:100}]}))];dfcHoje=()=>'2026-10-12';`);
 assert.match(a.run('tabelaPlano(contextoPlano())'),/sem meses completos em 2026 e 2025 para comparar/);
 // código 51+ reaproveitado: Agência em 2025, Acabamento e Lona em 2026
 const b=ctx();comAnos(b);b.run(`state.records.find(r=>r.label==='Ago/2026').cells.push({code:'2.12.51',name:'Acabamento',value:200});state.records.find(r=>r.label==='Set/2026').cells.push({code:'2.12.51',name:'Lona',value:900});state.records.find(r=>r.label==='Ago/2025').cells.push({code:'2.12.51',name:'Agência',value:300});`);
 const r51=J(b,"(()=>{const x=contextoPlano();return planoAno(x,'2.12.51',planoMesesComparaveis(x));})()");
 assert.equal(r51.total,null,'nomes diferentes no ano não somam');assert.equal(r51.delta,null);assert.match(r51.motivo,/renomeada/);
 // conta que só existe em 2026: o ano anterior não é zero
 b.run(`state.records.find(r=>r.label==='Set/2026').cells.push({code:'2.7.9',name:'Nova',value:50});`);
 const nova=J(b,"(()=>{const x=contextoPlano();return planoAno(x,'2.7.9',planoMesesComparaveis(x));})()");assert.equal(nova.prev,null);assert.match(nova.motivo,/não existia/);
 // centavos: 100,10 + 200,20 contra 150,15 + 150,15 é estável, não "−0%"
 const c=ctx();comAnos(c);c.run(`for(const [l,v] of [['Ago/2026',100.10],['Set/2026',200.20],['Ago/2025',150.15],['Set/2025',150.15]])state.records.find(r=>r.label===l).cells.find(x=>x.code==='2.5.3').value=v;`);
 const cc=J(c,"(()=>{const x=contextoPlano();return planoAno(x,'2.5.3',planoMesesComparaveis(x));})()");assert.equal(cc.delta,0);assert.equal(cc.pct,0);
 c.run("state.anoTodo=true;state.contaSelecionada='2.5.3'");assert.match(c.run('dashboardPlano(contextoPlano())'),/O valor ficou estável/);
 // a planilha só é montada na aba dela
 c.run("state.anoTodo=false;state.contaSelecionada='';planoUI.aba='dashboard'");assert.doesNotMatch(c.run('renderPlanoContas()'),/data-plano-linha=/);
 c.run("planoUI.aba='planilha'");assert.match(c.run('renderPlanoContas()'),/data-plano-linha=/);
 // com filtro, sem botões de abrir e recolher (tudo aberto)
 c.run("state.consulta='cemig'");const h=c.run('renderPlanoContas()');assert.doesNotMatch(h,/data-plano-ramo=|data-plano-matriz=/);assert.match(h,/tudo aberto/);
});

// ── Fase 13.1: entradas e saídas juntas no Dashboard ──
test('entradas e saídas juntas: mês com saldo, comparação, composição de cada lado e volta para a conta ao escolher',()=>{
 const c=ctx();c.run("state.contaSelecionada='1';state.comparar='Ago/2026';planoUI.juntas=true");const h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/data-plano-juntas="sim" aria-pressed="true"/);assert.match(h,/⇄ Entradas e saídas <small>· Set\/2026/);
 assert.match(h,/Set\/2026 · entradas<\/small><strong class="tom-entra">R\$\s1\.000,00/);assert.match(h,/Set\/2026 · saídas<\/small><strong class="tom-sai">R\$\s500,00/);
 assert.match(h,/Saldo \(entradas − saídas\)<\/small><strong class="tom-entra">R\$\s500,00/);
 assert.match(h,/as saídas consumiram 50,0% das entradas: sobrou R\$\s500,00\. Em Ago\/2026 o saldo foi R\$\s500,00\./);
 assert.match(h,/Para onde foi · Set\/2026[\s\S]*Cemig[\s\S]*30,0%/,'Cemig é 30% das saídas');assert.match(h,/De onde veio · Set\/2026<\/h3><p class="hint">Sem subcontas/);
 assert.match(h,/aria-label="Set\/2026 · Entradas: R\$\s1\.000,00 · Saídas: R\$\s500,00/,'gráfico com as duas séries');
 assert.match(h,/<tfoot><tr><th scope="row">Total 2026<\/th><td class="num tom-entra">R\$\s2\.000,00<\/td><td class="num tom-sai">R\$\s1\.000,00<\/td><td class="num tom-entra">R\$\s1\.000,00<\/td><td class="num">50,0%<\/td>/);
 assert.match(h,/<td>Jan\/2026<\/td><td class="num ">—<\/td><td class="num ">—<\/td><td class="num ">—<\/td>/,'mês sem registro fica em branco, não zero');
 c.run("planoSelecionar('2.5.3')");assert.equal(c.run('planoUI.juntas'),false,'escolher uma conta volta para a conta');
});
test('entradas e saídas juntas no chip Ano: mesmos meses do ano anterior e o saldo comparado',()=>{
 const c=ctx();comAnos(c);c.run("state.anoTodo=true;planoUI.juntas=true");const h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/Ano 2026 contra 2025/);assert.match(h,/Entradas · Ago a Set<\/small><strong class="tom-entra">R\$\s2\.000,00<\/strong><small>2025: R\$\s1\.600,00 · \+25,0%/);
 assert.match(h,/Nos mesmos meses \(Ago a Set\), as saídas consumiram 50,0% das entradas, contra 50,0% em 2025\. O saldo melhorou R\$\s200,00\./);
 const sem=ctx();sem.run("state.anoTodo=true;planoUI.juntas=true");assert.match(sem.run('dashboardPlano(contextoPlano())'),/Sem outro ano com dados para comparar\./,'v136: sem 2025 nos dados, não há ano para comparar');
});

// ── v133: cor das diferenças, celular, Ano e PDF ──
test('v133: diferença do mês com seta e tom de bom ou ruim, cabeçalho curto "Δ <mês>" e série com sentido',()=>{
 const c=ctx();c.run("state.contaSelecionada='2.5';state.comparar='Ago/2026';state.records.forEach((r,i)=>r.cells.push({code:'2.5',name:'Fixas',value:i?150:100},{code:'2.5.9',name:'Gás',value:i?50:0}))");
 const h=c.run('dashboardPlano(contextoPlano())');
 // despesa fixa subiu R$ 50: ruim (vermelho), com ▲ e sem sinal
 assert.match(h,/Diferença entre os meses<\/small><strong class="delta-ruim">▲ R\$\s50,00<\/strong>/);
 assert.match(h,/<th class="num">Δ Ago\/2026<\/th>/);assert.doesNotMatch(h,/Diferença para/);
 assert.match(h,/<td class="num delta-ruim">▲ R\$\s50,00<\/td>/,'subconta Gás subiu: ruim');
 c.run("state.contaSelecionada='1';state.records[1].cells.find(x=>x.code==='1').value=800");
 assert.match(c.run('dashboardPlano(contextoPlano())'),/<strong class="delta-ruim">▼ R\$\s200,00<\/strong>/,'entrada caiu: ruim');
 assert.match(c.run('comparativosConta(contextoPlano())'),/<td class="num delta-ruim">▼ R\$\s200,00<\/td>/,'Δ mês anterior com a mesma regra');
 // dívida (2.13) e sócios (2.14) não são bom nem ruim por si
 assert.equal(c.run("planoDeltaTom('2.14.2',100)"),'');assert.equal(c.run("planoDeltaTom('2.5.3',-10)"),'delta-bom');
});
test('v133: legenda fora da área que rola, "*" só para mês incompleto e "°" para cobertura a conferir',()=>{
 const c=ctx();c.run("planoUI.aba='planilha';state.records[0].qualidade.estado='cobertura-nao-validada';state.records[1].qualidade.ate='2026-09-20'");
 const h=c.run('tabelaPlano(contextoPlano())');
 assert.doesNotMatch(h,/<caption>/);assert.match(h,/<p class="hint plano-legenda">[\s\S]*\* = mês em andamento ou incompleto · ° = cobertura a conferir/);
 assert.match(h,/<th scope="col" class="num ">Ago °<\/th>/);assert.match(h,/<th scope="col" class="num selected-month">Set \*<\/th>/);
 assert.match(h,/<span hidden data-plano-esquerda> · Jan a Ago à esquerda/,'aviso dos meses à esquerda, que só aparece com a planilha rolada');
});
test('v133: com o chip Ano, nenhuma coluna destacada nem aviso de meses à esquerda',()=>{
 const c=ctx();c.run("state.anoTodo=true;planoUI.aba='planilha'");const h=c.run('tabelaPlano(contextoPlano())');
 assert.doesNotMatch(h,/selected-month/);assert.doesNotMatch(h,/data-plano-esquerda/);
 c.run("planoUI.juntas=true");assert.doesNotMatch(c.run('dashboardPlano(contextoPlano())'),/selected-month/);
});
test('v133: filtros num details com o resumo no summary; lateral fechada por padrão só na aba Planilha',()=>{
 const c=ctx();let h=c.run('renderPlanoContas()');
 assert.match(h,/<details class="plano-filtros" open><summary>Filtrar contas<\/summary><div class="plano-toolbar">/);
 c.run("state.consulta='cemig';state.tipo='2'");h=c.run('renderPlanoContas()');assert.match(h,/<summary>Filtrar contas · “cemig” · Saídas<\/summary>/);
 // no celular, sem filtro, recolhido
 c.matchMedia=()=>({matches:true});c.run("state.consulta='';state.tipo='todos'");assert.match(c.run('renderPlanoContas()'),/<details class="plano-filtros"><summary>Filtrar contas<\/summary>/);
 c.matchMedia=()=>({matches:false});c.run("planoUI.lateral=null;planoUI.aba='planilha'");assert.equal(c.run('planoLateralAberta()'),false);
 c.run("planoUI.aba='dashboard'");assert.equal(c.run('planoLateralAberta()'),true,'sem gravar: no Dashboard continua aberta');assert.equal(c.run('planoUI.lateral'),null);
});
test('v133: PDF com a mesma cor do app (PDF_COR) nas tabelas de dinheiro',()=>{
 const c=ctx();vm.runInContext(fs.readFileSync(new URL('../pdf-cfo.js',import.meta.url),'utf8'),c);
 assert.deepEqual(JSON.parse(c.run('JSON.stringify(PDF_COR)')),{entra:[40,74,199],sai:[162,53,58]});
 const r=JSON.parse(c.run("JSON.stringify(relatorioCFO({periodo:'Set/2026'}))"));
 const retrato=r.blocos.find(b=>b.titulo==='Retrato do período');assert.deepEqual(retrato.tons,[['','entra'],['','sai'],['','entra']]);
 const dre=r.blocos.find(b=>/DRE Simples, linha por linha/.test(b.titulo));assert.ok(dre.tons.some(t=>t[1]==='sai'),'saídas em vermelho');
 for(const f of ['pdf-cfo.js','plano-contas.js'])assert.doesNotMatch(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),/\[(47,98,208|172,65,76|199,66,76|47,78,191|170,51,62)\]/,f+': nenhum outro RGB de dinheiro');
});

// ── v135 ──
test('v135 (N23): sem conta e sem filtro, entradas e saídas juntas no automático; "Conta escolhida" mostra as saídas com a nota',()=>{
 const c=ctx();assert.equal(c.run('planoUI.juntas'),null,'começa automático');
 let h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/data-plano-juntas="sim" aria-pressed="true">⇄ Entradas e saídas juntas/);assert.match(h,/data-plano-juntas="nao" aria-pressed="false"/);assert.match(h,/class="plano-dashboard plano-juntas"/);
 c.run("planoUI.juntas=false");h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/data-plano-juntas="nao" aria-pressed="true">Conta escolhida/);
 assert.match(h,/<h2>📊 Saídas <small>· 2<\/small><small>· total das saídas, nenhuma conta escolhida<\/small><\/h2>/);
 // com filtro, o automático mostra a conta (sem juntas); com conta, nada de nota
 c.run("planoUI.juntas=null;state.tipo='1'");h=c.run('dashboardPlano(contextoPlano())');assert.doesNotMatch(h,/class="plano-dashboard plano-juntas"/);assert.match(h,/total das entradas, nenhuma conta escolhida/);
 c.run("state.tipo='todos';state.contaSelecionada='2.5.3'");h=c.run('dashboardPlano(contextoPlano())');assert.doesNotMatch(h,/nenhuma conta escolhida|class="plano-dashboard plano-juntas"/);
 c.run("planoUI.juntas=true;state.contaSelecionada='2.5.3'");assert.match(c.run('dashboardPlano(contextoPlano())'),/class="plano-dashboard plano-juntas"/,'a escolha da pessoa vence');
 // escolher conta volta para a conta; "Todas as contas" volta ao automático
 c.render=()=>{};c.run("planoSelecionar('2.5.3')");assert.equal(c.run('planoUI.juntas'),false);c.run("planoSelecionar('')");assert.equal(c.run('planoUI.juntas'),null);
});
test('v135 (I22): a lista lateral mostra o código do Mubisys quando difere',()=>{
 const c=ctx();c.run("state.records[1].cells.push({code:'2.12',name:'Materiais e Insumos',value:80},{code:'2.12.1',name:'Impressão',value:80})");
 const h=c.run('arvorePlano(contextoPlano())');
 assert.match(h,/<span>Materiais e Insumos<\/span><small>2\.12 · Mubisys 2\.9<\/small><\/button>/);assert.match(h,/<span>Cemig<\/span><small>2\.5\.3 · Mubisys 2\.4\.3<\/small>/);
});
test('v135 (I15, D16): ano pela metade com a coluna do ano corrente nos mesmos meses; o Δ fecha com as colunas visíveis e tem uma casa',()=>{
 const c=ctx();comAnos(c);c.run("planoUI.matriz=new Set(['1','2'])");const h=c.run('tabelaPlano(contextoPlano())');
 const cel=code=>{const l=h.slice(h.indexOf(`data-plano-linha="${code}"`),h.indexOf('</tr>',h.indexOf(`data-plano-linha="${code}"`)));return [...l.matchAll(/<td class="num plano-ano[^"]*"[^>]*>([^<]*)<\/td>/g)].map(m=>m[1]);};
 const num=s=>Number(s.replace(/[▲▼%\s.]/g,'').replace(',','.'));
 for(const code of ['1','2','2.5.3']){const [,cur,prev,d]=cel(code);const pct=(num(cur)-num(prev))/num(prev)*100;assert.equal(Math.abs(Math.round(pct*10)/10),num(d),code);assert.match(d,/^[▲▼] \d+,\d%$/,'uma casa');}
 assert.equal(cel('2.5.3').join('|'),'250,00|250,00|200,00|▲ 25,0%');
 assert.equal((h.match(/<th scope="col"/g)||[]).length,17,'conta, 12 meses, total, ano nos mesmos meses, ano anterior e Δ');
 c.run("state.consulta='zzz'");assert.match(c.run('tabelaPlano(contextoPlano())'),/<td colspan="17">Nenhuma conta/);
 // sem comparação: sem a coluna nova, colspan 16
 const s=ctx();s.run("state.consulta='zzz'");const hs=s.run('tabelaPlano(contextoPlano())');assert.match(hs,/<td colspan="16">/);assert.equal((hs.match(/<th scope="col"/g)||[]).length,16);
 // estável vira "0,0%"; percentuais do dashboard também com uma casa
 c.run(`state.consulta='';for(const [l,v] of [['Ago/2026',100],['Set/2026',100],['Ago/2025',100],['Set/2025',100]])state.records.find(r=>r.label===l).cells.find(x=>x.code==='2.5.3').value=v;`);
 assert.match(c.run('tabelaPlano(contextoPlano())'),/data-plano-linha="2\.5\.3"[\s\S]*?>0,0%<\/td><\/tr>/);
 assert.equal(c.run('planoUmaCasa(-0.04)'),'0,0');assert.equal(c.run('planoUmaCasa(61)'),'61,0');assert.equal(c.run('planoPctTxt(-12.345)'),'−12,3%');
});
test('v135 (N25): no Plano um só "↓ Planilha" (o do topo); DFC, Balanço e Preço baixam pelo topo o mesmo arquivo da tela',()=>{
 const c=ctx();const h=c.run('renderPlanoContas()');assert.doesNotMatch(h,/id="exportAccounts"/);assert.match(h,/data-plano-tab="planilha"[^>]*>📋 Mês a mês</);
 assert.doesNotMatch(fs.readFileSync(new URL('../plano-contas.js',import.meta.url),'utf8'),/exportAccounts/);
 const chamou=[];c.dfcCSV=()=>chamou.push('dfc');c.balCSV=()=>chamou.push('balanco');c.precosCSV=()=>chamou.push('precos');
 for(const v of ['dfc','balanco','precos'])c.run(`state.view='${v}';baixarPlanilhaTela()`);
 assert.deepEqual(chamou,['dfc','balanco','precos']);
});

// ── Ano em todas as telas: o ano de comparação escolhido em "Comparar com" (PLA-1, PLA-3) ──
// O contrato do app (anoComparado, telaNoAno...) vem de app.js; sem ele (frente ainda não integrada),
// a mesma regra do PLANO-ANO §2.2 em versão mínima, só para estes testes.
const CONTRATO=`
if(typeof telaNoAno!=='function')globalThis.telaNoAno=()=>anoAtivo()&&!anoCompetencia();
if(typeof anoDaTela!=='function')globalThis.anoDaTela=()=>Number(String(state.periodo).split('/')[1])||null;
if(typeof anosComparaveis!=='function')globalThis.anosComparaveis=(ano=anoDaTela())=>[...new Set(state.records.map(r=>Number(String(r.label).split('/')[1])).filter(Boolean))].filter(y=>y!==ano).sort((a,b)=>b-a);
if(typeof anoPadraoComparado!=='function')globalThis.anoPadraoComparado=(ano=anoDaTela())=>{const l=anosComparaveis(ano);return l.includes(ano-1)?ano-1:l.find(y=>y<ano)??null;};
if(typeof anoComparado!=='function')globalThis.anoComparado=()=>{const v=String(state.anoComparar??'');if(v==='nenhum')return null;if(/^\\d{4}$/.test(v)&&anosComparaveis().includes(Number(v)))return Number(v);return anoPadraoComparado();};
if(typeof rotuloAno!=='function')globalThis.rotuloAno=(ano=anoDaTela())=>{const f=fimDoAno(ano),i=PT_MON.indexOf(f.split('/')[0]),r=state.records.find(x=>x.label===f);return ano+' · '+(i>0?'Jan a '+PT_MON[i]:'Jan')+(r&&F.qualidade(r).parcial?'*':'');};
`;
const com24=c=>c.run(`state.records=[...state.records,...['Ago','Set'].map((m,i)=>({label:m+'/2024',company:'Impresilk + Universo',basis:'Caixa',origem:'erp',qualidade:{ate:i?'2024-09-30':'2024-08-31',estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:[{code:'1',name:'Entradas',value:500},{code:'2',name:'Saídas',value:250},{code:'2.5.3',name:'Cemig',value:50}]}))];`);
const noAno=(c,comp)=>{comAnos(c);com24(c);c.run(CONTRATO);c.run(`state.view='detalhe';state.anoTodo=true;state.anoComparar=${JSON.stringify(comp)};planoUI.matriz=new Set(['1','2'])`);return c;};
test('Ano com "Comparar com" 2024: dashboard, entradas e saídas juntas e planilha contra 2024, nos mesmos meses',()=>{
 const c=noAno(ctx(),'2024');assert.equal(c.run('anoComparado()'),2024);
 c.run("state.contaSelecionada='2.5.3'");let h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/<span class="plano-compare">Ano 2026 contra 2024<\/span>/);assert.match(h,/<small>2024 · mesmos meses<\/small><strong class="tom-sai">R\$\s100,00/);
 assert.match(h,/Aumentou R\$\s150,00 \(\+150,0%\) contra 2024 nos mesmos meses \(Ago a Set\)/);assert.doesNotMatch(h,/2025/,'2025 não aparece como ano comparado');
 c.run("planoUI.juntas=true");h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/Ano 2026 contra 2024/);assert.match(h,/<small>2024: R\$\s1\.000,00 · \+100,0%/);assert.match(h,/contra 50,0% em 2024\. O saldo melhorou R\$\s500,00\./);
 const t=c.run('tabelaPlano(contextoPlano())');
 assert.match(t,/<th scope="col" class="num plano-ano">2024<small>Ago a Set<\/small><\/th><th scope="col" class="num plano-ano">Δ 2026 × 2024<small>Ago a Set nos dois anos<\/small><\/th>/);
 assert.match(t,/comparação com 2024 em Ago a Set \(meses completos nos dois anos\)/);
 assert.match(t,/data-plano-linha="2\.5\.3"[\s\S]*?<td class="num plano-ano tom-sai"[^>]*>100,00<\/td><td class="num plano-ano delta-ruim"[^>]*>▲ 150,0%<\/td>/);
 // conta que não existia no ano comparado: o motivo diz o ano
 c.run("state.records.find(r=>r.label==='Set/2026').cells.push({code:'2.7.9',name:'Nova',value:50})");
 assert.match(J(c,"(()=>{const x=contextoPlano();return planoAno(x,'2.7.9',planoMesesComparaveis(x,2024),null,2024).motivo})()"),/^a conta não existia em 2024$/);
 // padrão (''): o ano anterior
 const d=noAno(ctx(),'');d.run("state.contaSelecionada='2.5.3'");assert.match(d.run('dashboardPlano(contextoPlano())'),/Ano 2026 contra 2025/);
 assert.match(d.run('tabelaPlano(contextoPlano())'),/Δ 2026 × 2025/);
});
test('Ano com "Sem comparação": sem as colunas do outro ano, colspan certo, legenda e o texto do topo',()=>{
 const c=noAno(ctx(),'nenhum');assert.equal(c.run('anoComparado()'),null);
 c.run("state.contaSelecionada='2.5.3'");let h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/<span class="plano-compare">Ano 2026 · sem comparação<\/span>/);assert.match(h,/<small>Ano comparado<\/small><strong>Sem comparação<\/strong>/);
 assert.match(h,/Sem comparação: escolha um ano em “Comparar com”, no topo\./);assert.match(h,/<small>2026 · meses com registro<\/small><strong class="tom-sai">R\$\s250,00/,'o ano todo, sem inventar comparação');
 assert.doesNotMatch(h,/2025|2024|Aumentou|Diminuiu/);
 c.run("planoUI.juntas=true");h=c.run('dashboardPlano(contextoPlano())');assert.match(h,/Ano 2026 · sem comparação/);assert.match(h,/Sem comparação: escolha um ano em “Comparar com”, no topo\. Os números são do ano/);assert.doesNotMatch(h,/2025|2024/);
 const t=c.run('tabelaPlano(contextoPlano())');
 assert.equal((t.match(/<th scope="col"/g)||[]).length,14,'conta, 12 meses e o total');assert.doesNotMatch(t,/Δ 2026|2025|2024/);
 assert.match(t,/sem comparação com outro ano \(escolha em “Comparar com”, no topo\)/);
 const linha=t.slice(t.indexOf('data-plano-linha="2.5.3"'),t.indexOf('</tr>',t.indexOf('data-plano-linha="2.5.3"')));assert.equal((linha.match(/<td/g)||[]).length,13,'12 meses e o total');
 c.run("state.consulta='zzz'");assert.match(c.run('tabelaPlano(contextoPlano())'),/<td colspan="14">Nenhuma conta/);
});
test('fora do Ano, o "Comparar com" de ano não muda nada: o ano anterior, como na v135',()=>{
 const c=ctx();comAnos(c);com24(c);c.run(CONTRATO);c.run("state.view='detalhe';state.anoTodo=false;state.anoComparar='2024';planoUI.matriz=new Set(['1','2'])");
 const t=c.run('tabelaPlano(contextoPlano())');assert.match(t,/Δ 2026 × 2025/);assert.doesNotMatch(t,/2024/);
 c.run("state.contaSelecionada='2.5.3';state.comparar='Ago/2026'");assert.match(c.run('dashboardPlano(contextoPlano())'),/id="planoCompare"/,'o seletor de mês continua');
 const n=ctx();comAnos(n);n.run(CONTRATO);n.run("state.anoComparar='nenhum'");assert.match(n.run('tabelaPlano(contextoPlano())'),/Δ 2026 × 2025/,'Sem comparação só vale no Ano');
});
test('meses comparados em texto: faixas com lacuna e mês único, como rotuloMesesAno do app',()=>{
 const c=ctx();const t=idx=>c.run(`planoMesesTxt(${JSON.stringify(idx.map(i=>({m:{label:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][i]+'/2026'}})))})`);
 assert.equal(t([0,1,2,3,4,5,6,7]),'Jan a Ago');assert.equal(t([3]),'Abr');assert.equal(t([0,1,2,4]),'Jan a Mar e Mai');assert.equal(t([0,1,3,5,6]),'Jan a Fev, Abr e Jun a Jul');assert.equal(t([...Array(12).keys()]),'ano inteiro');assert.equal(t([]),'');
});
test('"↓ Planilha" no Ano: período do ano, ano comparado e arquivo com o ano; Conferência com todas as pendências do ano e a coluna Mês',()=>{
 const c=noAno(ctx(),'2024');const baixados=[];c.download=(nome,conteudo)=>baixados.push({nome,conteudo});
 c.document.getElementById=id=>({pageTitle:{textContent:'Dashboard'},pageContent:{querySelectorAll:()=>[]}})[id]||null;
 c.run("state.records.find(r=>r.label==='Set/2026').qualidade.ate='2026-09-20';dfcHoje=()=>'2026-09-22';state.view='inicio';state.periodo='Set/2026'");
 c.run('baixarPlanilhaTela()');assert.equal(baixados[0].nome,'dre-inicio-2026.csv');
 assert.match(baixados[0].conteudo,/"Período";"2026 · Jan a Set\*"/);assert.match(baixados[0].conteudo,/"Comparar com";"2024"/);
 c.run("state.anoComparar='nenhum'");c.run('baixarPlanilhaTela()');assert.match(baixados[1].conteudo,/"Comparar com";"Sem comparação"/);
 // Conferência: uma linha por pendência de cada mês do ano, com o mês na frente
 c.run(`state.view='conferencia';gestaoUI.pendTipo='todos';gestaoUI.pendBusca='';state.records.find(r=>r.label==='Ago/2026').pendencias=[{tipo:'Sem conta',conta:'2.99',texto:'Pagamento sem conta',valor:10}];state.records.find(r=>r.label==='Set/2026').pendencias=[{tipo:'Sem conta',conta:'2.99',texto:'Outro pagamento',valor:20}];state.records.find(r=>r.label==='Set/2025').pendencias=[{tipo:'Sem conta',conta:'2.99',texto:'Do ano passado',valor:30}]`);
 c.run('baixarPlanilhaTela()');const conf=baixados[2];assert.equal(conf.nome,'conferencia-2026.csv');
 assert.match(conf.conteudo,/"Mês";"Tipo";"Conta";"Ocorrência"/);assert.match(conf.conteudo,/"Ago\/2026";"Sem conta";"2\.99";"Pagamento sem conta"/);assert.match(conf.conteudo,/"Set\/2026";"Sem conta";"2\.99";"Outro pagamento"/);
 assert.doesNotMatch(conf.conteudo,/Do ano passado/);assert.match(conf.conteudo,/"Período";"2026 · Jan a Set\*"/);
 // fora do Ano, como na v135
 c.run("state.anoTodo=false");c.run('baixarPlanilhaTela()');assert.equal(baixados[3].nome,'conferencia-Set_2026.csv');assert.doesNotMatch(baixados[3].conteudo,/"Mês";/);
 c.run("state.view='inicio';state.comparar='Ago/2026'");c.run('baixarPlanilhaTela()');assert.equal(baixados[4].nome,'dre-inicio-Set_2026.csv');assert.match(baixados[4].conteudo,/"Período";"Set\/2026"/);assert.match(baixados[4].conteudo,/"Comparar com";"Ago\/2026"/);
});
