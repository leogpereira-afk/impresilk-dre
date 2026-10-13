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
test('atalhos só apontam para contas existentes e painel inicia recolhido por níveis',()=>{const c=ctx();const html=c.run('renderPlanoContas()');assert.match(html,/⚡/);assert.match(html,/💧/);assert.doesNotMatch(html,/👥/);assert.match(html,/class="plano-children" hidden/);assert.match(html,/📊 Dashboard/);assert.match(html,/📋 Planilha e comparativos/);});
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
test('colunas do ano: total, ano anterior só nos meses fechados nos dois anos e a diferença na cor do sentido',()=>{
 const c=ctx();comAnos(c);c.run("planoUI.matriz=new Set(['1','2'])");const h=c.run('tabelaPlano(contextoPlano())');
 assert.match(h,/Total 2026<\/th><th scope="col" class="num plano-ano">2025<small>Ago a Set<\/small><\/th><th scope="col" class="num plano-ano">Δ 2026 × 2025/);
 // Cemig: 100 + 150 = 250 em 2026; 200 em 2025 nos mesmos meses: +25% de saída = vermelho
 assert.match(h,/data-plano-linha="2\.5\.3"[\s\S]*?<td class="num plano-ano tom-sai">250,00<\/td><td class="num plano-ano">200,00<\/td><td class="num plano-ano tom-sai"[^>]*>\+25%<\/td>/);
 // Entradas: 2.000 contra 1.600: +25% em azul
 const linha1=h.slice(h.indexOf('data-plano-linha="1"'),h.indexOf('</tr>',h.indexOf('data-plano-linha="1"')));
 assert.match(linha1,/<td class="num plano-ano tom-entra">2\.000,00<\/td><td class="num plano-ano">1\.600,00<\/td><td class="num plano-ano tom-entra"[^>]*>\+25%<\/td>/,'entradas subiram: azul');
 const sem=ctx();assert.match(sem.run('tabelaPlano(contextoPlano())'),/sem meses fechados em 2026 e 2025 para comparar/);
});
test('chip Ano no Plano de contas: o Dashboard compara o ano com o anterior nos mesmos meses',()=>{
 const c=ctx();comAnos(c);c.run("state.anoTodo=true;state.contaSelecionada='2.5.3'");const h=c.run('dashboardPlano(contextoPlano())');
 assert.match(h,/Ano 2026 contra 2025/);assert.match(h,/Aumentou R\$\s50,00 \(\+25%\) contra 2025 nos mesmos meses \(Ago a Set\)/);
 assert.match(c.run('ANO_TELAS.join()'),/detalhe/);
});
const J=(c,s)=>JSON.parse(c.run(`JSON.stringify(${s})`));
test('revisão 12.5: base diferente não compara; código 51+ com nomes diferentes não soma nem compara; conta nova não vira zero; centavos; planilha só na aba dela',()=>{
 // 2025 de outra empresa: nada a comparar
 const a=ctx();a.run(`state.records=[...state.records,...['Ago','Set'].map((m,i)=>({label:m+'/2025',company:'Impresilk',basis:'Caixa',origem:'erp',qualidade:{ate:i?'2025-09-30':'2025-08-31',estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:[{code:'1',name:'Entradas',value:800},{code:'2',name:'Saídas',value:400},{code:'2.5.3',name:'Cemig',value:100}]}))];dfcHoje=()=>'2026-10-12';`);
 assert.match(a.run('tabelaPlano(contextoPlano())'),/sem meses fechados em 2026 e 2025 para comparar/);
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
