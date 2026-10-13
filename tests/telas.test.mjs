// Registro único de telas e esqueleto dos seis controles (Fase 1).
// Trava o que antes quebrava em silêncio: botão do menu sem página, sem título
// ou sem rota, e tela nova que mostrasse número inventado no lugar de "Não apurado".
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function context(hash=''){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash},URLSearchParams};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 c.run=s=>vm.runInContext(s,c);c.run("state.periodo='Set/2026';state.cfg={};");return c;
}
const dataViews=[...html.matchAll(/data-view="([a-z]+)"/g)].map(m=>m[1]);
const novas=['dfc','balanco','giro','recebiveis','precos','parametros'];

test('todo botão do menu tem título, página e rota; nenhum aparece duas vezes',()=>{
 const c=context();
 const meta=c.run('Object.keys(METADATA_TELAS)'),paginas=c.run('Object.keys(paginasDoApp())');
 assert.equal(new Set(dataViews).size,dataViews.length,'data-view repetido no menu');
 for(const v of [...dataViews,'config','ajuda','resultado','custos']){
  assert.ok(meta.includes(v),'sem título/descrição: '+v);
  assert.ok(paginas.includes(v),'sem página: '+v);
 }
 for(const v of novas)assert.ok(dataViews.includes(v),'tela nova fora do menu: '+v);
});
test('rota por hash abre as telas novas e preserva mês, comparação e base',()=>{
 for(const v of novas){
  const c=context(`#tela=${v}&mes=Ago%2F2026&comparar=Jul%2F2026&base=competencia`);c.run('restaurarRota()');
  assert.equal(c.run('state.view'),v);assert.equal(c.run('state.periodo'),'Ago/2026');assert.equal(c.run('state.comparar'),'Jul/2026');assert.equal(c.run('dreUI.base'),'competencia');
 }
 const c=context('#tela=inexistente&mes=Ago%2F2026');c.run("state.view='inicio';restaurarRota()");assert.equal(c.run('state.view'),'inicio','tela desconhecida não substitui a atual');
});
test('menu tem quatro grupos recolhíveis, com Análise CFO e as telas novas',()=>{
 const grupos=[...html.matchAll(/<details class="nav-grupo" data-grupo="([a-z]+)"[^>]*><summary>([^<]+)<\/summary>(.*?)<\/details>/g)];
 assert.deepEqual(grupos.map(g=>g[1]),['visao','demonstrativos','gestao','base']);
 assert.deepEqual(grupos.map(g=>[...g[3].matchAll(/data-view="([a-z]+)"/g)].map(m=>m[1])),[['inicio','cfo'],['dre','dfc','balanco'],['caixa','giro','recebiveis','precos','indicadores'],['detalhe','parametros','conferencia','glossario']]);
 assert.match(html,/id="menuToggle"[^>]*aria-expanded="false"[^>]*aria-controls="menuLateral"/);
});
test('telas novas seguem a ordem cards, gráficos e tabela fechada, sem número inventado',()=>{
 const c=context();
 for(const v of novas){
  const h=c.run(`renderControle(${JSON.stringify(v)})`);
  const cards=(h.match(/class="metric metric-vazio"/g)||[]).length;assert.ok(cards>=1&&cards<=4,v+': de 1 a 4 cards, veio '+cards);
  assert.equal((h.match(/<strong>Não apurado<\/strong>/g)||[]).length,cards,v+': todo card sem dado diz Não apurado');
  assert.ok((h.match(/class="grafico-reservado" role="img" aria-label="Gráfico ainda sem dados: /g)||[]).length>=2,v+': ao menos dois gráficos com rótulo acessível');
  assert.match(h,/<details class="card" data-card="[^"]*"><summary>/,v+': tabela detalhada fica dentro de details fechado (e lembra se a pessoa abriu)');
  assert.match(h,/class="estado-vazio"[\s\S]*O que falta[\s\S]*De onde virá[\s\S]*Próximo passo/,v+': estado vazio explica falta, origem e próximo passo');
  assert.ok(h.indexOf('cards-controle')<h.indexOf('graficos-controle')&&h.indexOf('graficos-controle')<h.indexOf('<details class="card"'),v+': ordem cards, gráficos, tabela');
  assert.doesNotMatch(h,/R\$|\d+,\d{2}|>0<|>0,00/,v+': nenhum valor monetário ou zero inventado');
 }
 assert.match(c.run("renderControle('dfc')"),/data-go="parametros"/,'tela de controle leva ao cadastro');
 assert.doesNotMatch(c.run("renderControle('parametros')"),/data-go="parametros"/,'Parâmetros não aponta para si mesmo');
 assert.equal(c.run("renderControle('inexistente')"),'');
});
test('carregar os scripts sem DOM continua possível (menu só liga no navegador)',()=>{
 const c=context();assert.equal(c.run("typeof wireMenuLateral"),'function');assert.doesNotThrow(()=>c.run('sincronizarMenu()'));
});
test('cada card aponta para onde se resolve o que falta, e nenhum promete cadastro que Parâmetros não tem',()=>{
 const c=context();
 const cards=v=>[...c.run(`renderControle(${JSON.stringify(v)})`).matchAll(/<div class="metric metric-vazio"><span class="label">([^<]+)<\/span>[\s\S]*?class="origem-dado origem-([a-e])"[\s\S]*?<\/div>/g)].map(m=>({rotulo:m[1],origem:m[2],link:(m[0].match(/data-go="([a-z]+)"/)||[])[1]||null}));
 for(const v of novas)for(const k of cards(v)){
  if(k.origem==='b')assert.ok(['detalhe','parametros'].includes(k.link),v+' '+k.rotulo+': mapeamento leva ao Plano de contas');
  if(k.origem==='d'&&v!=='parametros'&&k.rotulo!=='Patrimônio líquido')assert.equal(k.link,'parametros',v+' '+k.rotulo+': cadastro leva a Parâmetros');
  if(k.origem==='e')assert.equal(k.link,null,v+' '+k.rotulo+': valor calculado não tem cadastro');
 }
 assert.equal(cards('dfc').find(k=>k.rotulo.startsWith('Caixa da operação')).link,'detalhe');
 assert.deepEqual(cards('balanco').find(k=>k.rotulo==='Diferença do fechamento'),{rotulo:'Diferença do fechamento',origem:'e',link:null});
 assert.deepEqual(cards('balanco').find(k=>k.rotulo==='Patrimônio líquido'),{rotulo:'Patrimônio líquido',origem:'d',link:null},'Parâmetros não tem campo de patrimônio (Fase 8): sem link de cadastro');
 assert.equal(cards('recebiveis').find(k=>k.rotulo==='Acima de 90 dias').origem,'c','a faixa vem dos títulos do Painel; só a PDD é cadastro');
 for(const v of novas)assert.doesNotMatch(c.run(`renderControle(${JSON.stringify(v)})`),/class="primary" data-go="parametros"/,v+': sem botão principal para uma tela que ainda não cadastra');
});
test('Parâmetros já existe: links e próximos passos falam no presente, sem prometer a Fase 2',()=>{
 const c=context();
 for(const v of ['dfc','balanco','giro','recebiveis','precos']){
  const h=c.run(`renderControle(${JSON.stringify(v)})`);
  assert.doesNotMatch(h,/será cadastrado|entra com o cadastro|\(Fase 2\)|Fase 2\b/,v+': nada de cadastro no futuro');
  assert.match(h,/<button type="button" data-go="parametros">Cadastrar em Parâmetros<\/button><\/section>/,v+': botão do estado vazio leva ao cadastro');
 }
 assert.match(c.run("renderControle('dfc')"),/class="link-cadastro" data-go="parametros">Cadastrar em Parâmetros →<\/button>/);
 const passo=v=>c.run(`renderControle(${JSON.stringify(v)})`).match(/<dt>Próximo passo<\/dt><dd>([^<]+)/)[1].trim();
 assert.match(passo('dfc'),/^Fase 4: .*o saldo inicial informado em Parâmetros será usado quando esta tela ganhar cálculo\.$/);
 assert.match(passo('giro'),/^Fase 6: .*o estoque informado em Parâmetros será usado quando esta tela ganhar cálculo\.$/);
 assert.match(passo('recebiveis'),/^Fase 5: .*a provisão acima de 90 dias informada em Parâmetros será usada quando esta tela ganhar cálculo\.$/);
 assert.match(passo('precos'),/^Fase 7: .*a alíquota efetiva de Parâmetros será usada quando esta tela ganhar cálculo\.$/);
});
test('tabelas têm o rótulo da linha na primeira coluna e só números alinhados como número',()=>{
 const c=context();const h=c.run("renderControle('parametros')");
 assert.match(h,/<th scope="col">Empresa<\/th><th scope="col">Mês<\/th>/);assert.match(h,/<tr><th scope="row">Impresilk<\/th>/);
 assert.match(c.run("renderControle('recebiveis')"),/<th scope="col">Tipo<\/th>/);
 assert.doesNotMatch(h,/<th scope="col" class="num">(Empresa|Mês|Anexo|Revisado em)/);
});
test('textos seguem os fatos do negócio: DAS mensal por empresa, parcelamento à parte, DIFAL fora do DAS',()=>{
 const c=context();const p=c.run("renderControle('parametros')"),pr=c.run("renderControle('precos')"),b=c.run("renderControle('balanco')"),d=c.run("renderControle('dfc')");
 assert.match(p,/2\.4\.1\.2 e 2\.4\.1\.3[\s\S]*mês seguinte[\s\S]*parcelamento \(2\.4\.1\.1\) fica de fora/);
 assert.match(p,/não há pró-labore/);
 assert.match(pr,/DIFAL/);assert.match(b,/DAS e DIFAL/);assert.match(d,/parcelamento \(2\.4\.1\.1\) vai para financiamento/);
});
// v133 (N15 e I19): um nome por tela, igual ao menu, no título e na Ajuda, com botão para cada tela.
test('título de cada tela é o nome do menu; a Ajuda leva a todas as telas com os mesmos nomes',()=>{
 const c=context();const meta=c.run('METADATA_TELAS');
 const menu=Object.fromEntries([...html.matchAll(/data-view="([a-z]+)"><span class="ic"[^>]*>[^<]*<\/span><span>([^<]+)<\/span>/g)].map(m=>[m[1],m[2]]));
 assert.ok(Object.keys(menu).length>=14,'menu lido do index.html');
 for(const [v,nome] of Object.entries(menu))assert.equal(meta[v][0],nome,v+': título igual ao menu');
 assert.equal(meta.ajuda[0],(html.match(/id="helpBtn"[^>]*><span class="ic"[^>]*>[^<]*<\/span><span>([^<]+)/)||[])[1]);
 assert.equal(meta.config[0],(html.match(/id="settingsBtn"[^>]*><span class="ic"[^>]*>[^<]*<\/span><span>([^<]+)/)||[])[1]);
 const a=c.run('renderAjuda()');
 for(const [v,nome] of Object.entries(menu))if(v!=='ajuda')assert.match(a,new RegExp(`data-go="${v}">${nome}</button>`),'Ajuda leva a '+nome);
 assert.match(a,/data-go="custos">Despesas e categorias<\/button>/);
 assert.doesNotMatch(a+JSON.stringify(meta),/Detalhamento|Visão geral|Centros de custos|DRE mensal|Glossário financeiro|Ajuda financeira/);
});
// v133 (N9): cartão aberto ou fechado pela pessoa continua assim ao trocar o mês e ao voltar à tela.
test('cartões lembram a escolha por tela e título, sem o mês no título',()=>{
 const ouvintes=[];const c={structuredClone,document:{addEventListener:(t,f)=>ouvintes.push([t,f])},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 const run=s=>vm.runInContext(s,c);run("state.view='inicio'");
 const toggle=(chave,open)=>ouvintes.filter(([t])=>t==='toggle').forEach(([,f])=>f({target:{dataset:{card:chave},open}}));
 assert.match(run("card('Planilha do Dashboard · mês a mês','x',false)"),/^<details class="card" data-card="inicio:Planilha do Dashboard · mês a mês"><summary>/);
 assert.equal(run("cardChave('DRE Simples mês a mês · 2026')"),run("cardChave('DRE Simples mês a mês · 2025')"),'o ano não muda a chave');
 assert.equal(run("cardChave('Operação · Out/2026 · coletado até 08/10 (mês em andamento)')"),'inicio:Operação','mês e marca do parcial não mudam a chave');
 toggle('inicio:Planilha do Dashboard · mês a mês',false);assert.doesNotMatch(run("cardAttrs('Planilha do Dashboard · mês a mês',false)"),/open/,'toggle igual ao padrão, ao desenhar, não vira escolha');
 toggle('inicio:Planilha do Dashboard · mês a mês',true);assert.match(run("card('Planilha do Dashboard · mês a mês','x',false)"),/ open><summary>/,'aberto pela pessoa, continua aberto');
 run("state.view='dre'");assert.doesNotMatch(run("cardAttrs('Planilha do Dashboard · mês a mês',false)"),/open/,'outra tela, outra chave');
 run("state.view='inicio'");toggle('inicio:Conferência e próximos passos',false);assert.equal(run("cardAttrs('Conferência e próximos passos',true)"),'data-card="inicio:Conferência e próximos passos"','fechado pela pessoa, continua fechado');
});
// v133 (D32): mês, Comparar e cobertura somem onde não mudam nada.
test('controles sem efeito ficam escondidos: mês, Comparar e cobertura',()=>{
 const els={};const el=id=>els[id]||(els[id]={id,hidden:false,open:true,innerHTML:'',textContent:'',style:{},dataset:{},classList:{toggle(){}},setAttribute(){},focus(){},addEventListener(){}});
 const c={structuredClone,document:{body:{dataset:{}},addEventListener(){},getElementById:el,querySelector:s=>s==='.period'?el('.period'):null,querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 const run=s=>vm.runInContext(s,c);run("state.periodo='Set/2026';state.cfg={};state.D={accounts:[]};paginasDoApp=()=>({});wireContent=()=>{};renderInicio=()=>''");
 const vis=v=>{run(`state.view=${JSON.stringify(v)};render()`);return [!els['.period'].hidden,!els.periodCompare.hidden,!els.qualityBar.hidden];};
 for(const v of ['config','ajuda'])assert.deepEqual(vis(v),[false,false,false],v);
 for(const v of ['giro','recebiveis'])assert.deepEqual(vis(v),[false,false,false],v+': foto da carteira');
 for(const v of ['caixa','conferencia'])assert.deepEqual(vis(v),[true,false,true],v+': o mês conta, Comparar não');
 assert.deepEqual(vis('inicio'),[true,true,true],'Dashboard mantém os três');
 els.periodCompare.open=true;vis('cfo');assert.equal(els.periodCompare.open,false,'trocar de tela fecha o Comparar');
 // N1: trocar de tela leva ao topo e foca o título; Voltar do navegador e redesenho da mesma tela não
 run("__rolou=0;window={scrollTo:()=>{__rolou++}}");let focos=0;els.pageTitle.focus=o=>{assert.equal(o?.preventScroll,true);focos++;};
 vis('dre');assert.deepEqual([run('__rolou'),focos],[1,1]);vis('dre');assert.deepEqual([run('__rolou'),focos],[1,1],'mesma tela não rola');
 run("voltandoHistorico=true");vis('inicio');run("voltandoHistorico=false");assert.deepEqual([run('__rolou'),focos],[1,1],'Voltar não força o topo');
 // D33: com o Ano ligado, o chip diz o ano até o mês, não só o mês
 run("state.anoTodo=true;state.periodo='Ago/2025';state.view='dfc';render()");assert.match(els.qualityBar.innerHTML,/<span>2025 até Dez\/2025 · <b>/);
 run("state.view='inicio';render()");assert.match(els.qualityBar.innerHTML,/<span>Dez\/2025 · <b>/,'fora das telas do Ano, só o mês');
});

// v135: harness de render com menu, foco e Indicadores (N3, N4, N7, N16, N25, N26).
function telaRender(){
 const els={};const el=id=>els[id]||(els[id]={id,hidden:false,open:true,innerHTML:'',textContent:'',style:{},dataset:{},classList:{toggle(){}},setAttribute(){},focus(){},addEventListener(){},contains:()=>false});
 const menu=['inicio','indicadores','caixa','dfc'].map(v=>{const b={dataset:{view:v},attrs:{},ativo:false,classList:{toggle:(c,on)=>{if(c==='active')b.ativo=!!on;}},setAttribute:(k,x)=>{b.attrs[k]=x;}};return b;});
 const c={structuredClone,document:{body:{dataset:{}},activeElement:null,addEventListener(){},getElementById:el,querySelector:s=>s==='.period'?el('.period'):c.__qs?.(s)||null,querySelectorAll:s=>s==='[data-view]'?menu:[]},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 const run=s=>vm.runInContext(s,c);run("state.periodo='Set/2026';state.cfg={};state.D={accounts:[]};paginasDoApp=()=>({});wireContent=()=>{};renderInicio=()=>'<p>tela</p>';window={}");
 return {c,els,menu,run};
}
test('menu: Despesas acende Indicadores e Composição acende Caixa, com aria-current="true" no item-pai',()=>{
 const {menu,run}=telaRender();const estado=()=>Object.fromEntries(menu.map(b=>[b.dataset.view,[b.ativo,b.attrs['aria-current']]]));
 assert.deepEqual(JSON.parse(run('JSON.stringify(MENU_PAI)')),{custos:'indicadores',resultado:'caixa'});
 run("state.view='custos';render()");assert.deepEqual(estado(),{inicio:[false,'false'],indicadores:[true,'true'],caixa:[false,'false'],dfc:[false,'false']});
 run("state.view='resultado';render()");assert.deepEqual(estado().caixa,[true,'true']);
 run("state.view='dfc';render()");assert.deepEqual(estado().dfc,[true,'page']);assert.deepEqual(estado().caixa,[false,'false']);
});
test('"Veja também" vem depois da página; ↓ Planilha no topo em DFC, Balanço e Preço, sem PDF',()=>{
 const {els,run}=telaRender();run(`navContexto=()=>'<nav class="context-nav veja-tambem" aria-label="Veja também">x</nav>'`);
 run("state.view='inicio';render()");assert.equal(els.pageContent.innerHTML,'<p>tela</p><nav class="context-nav veja-tambem" aria-label="Veja também">x</nav>');
 const topo=v=>{run(`state.view=${JSON.stringify(v)};render()`);return [!els.cfoTools.hidden,!els.cfoPDF.hidden];};
 for(const v of ['dfc','balanco','precos'])assert.deepEqual(topo(v),[true,false],v+': planilha sim, PDF não');
 for(const v of ['giro','recebiveis','parametros','config','ajuda','indicadores','dre'])assert.equal(topo(v)[0],false,v+': sem ferramentas no topo');
 assert.deepEqual(topo('glossario'),[true,false]);assert.deepEqual(topo('inicio'),[true,true]);assert.deepEqual(topo('detalhe'),[true,true]);
});
test('Indicadores recebem a rota (área e fonte) no mount, uma vez só',()=>{
 const {run}=telaRender();run("__ctx=[];window={DREIndicadores:{mount:(el,ctx)=>__ctx.push(ctx.rota)}};api=()=>{};state.view='indicadores';state.indicadoresRota={area:'custos',fonte:'compras'};render()");
 assert.deepEqual(JSON.parse(run('JSON.stringify(__ctx)')),[{area:'custos',fonte:'compras'}]);assert.equal(run('state.indicadoresRota'),null,'a rota é usada uma vez e zerada');
 run('render()');assert.deepEqual(JSON.parse(run('JSON.stringify(__ctx)')),[{area:'custos',fonte:'compras'},null]);
});
test('foco volta ao controle depois do render na mesma tela; trocar de tela vai ao título',()=>{
 const {c,els,run}=telaRender();run("state.view='detalhe';render()");
 const aba={id:'',hasAttribute:a=>a==='data-plano-tab',getAttribute:()=>'planilha'},novo={focus(o){novo.foco=o;}};
 els.pageContent.contains=x=>x===aba;c.document.activeElement=aba;c.CSS={escape:s=>String(s).replace(/"/g,'\\"')};
 const pedidos=[];c.__qs=s=>{pedidos.push(s);return s.startsWith('#pageContent')?novo:null;};
 assert.equal(run('seletorFocoConteudo()'),'#pageContent [data-plano-tab="planilha"]');
 run('render()');assert.ok(pedidos.includes('#pageContent [data-plano-tab="planilha"]'));assert.equal(novo.foco?.preventScroll,true,'foco de volta na aba, sem rolar');
 novo.foco=null;run("state.view='dfc';render()");assert.equal(novo.foco,null,'outra tela: o foco vai ao título, não ao controle antigo');
 const comId={id:'planSaldo',hasAttribute:()=>false};els.pageContent.contains=()=>true;c.document.activeElement=comId;assert.equal(run('seletorFocoConteudo()'),'#planSaldo');
 els.pageContent.contains=()=>false;assert.equal(run('seletorFocoConteudo()'),'','foco fora do conteúdo: nada');
});
test('cartões com título h2 e cabeçalhos de tabela com scope',()=>{
 const c=context();assert.match(c.run("card('Saúde da informação','x')"),/<summary><h2 class="card-titulo">Saúde da informação<\/h2><\/summary><div class="card-body">x<\/div>/);
 const src=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/<th>|<th class=/,'todo th do app.js diz o scope');assert.match(src,/<th scope="col">Semana<\/th>/);
});
test('chip Ano depois da faixa de meses; mês apurado com classe, sem texto ✓; título do Ano sem "inteiro"',()=>{
 const els={};const el=id=>els[id]||(els[id]={id,innerHTML:'',textContent:'',style:{},setAttribute(){},querySelector:()=>null});
 const depois=[];els.monthChips={id:'monthChips',innerHTML:'',scrollWidth:0,clientWidth:0,querySelector:()=>null,parentNode:{insertBefore(){throw new Error('o chip vai depois da faixa');}},after:x=>depois.push(x)};
 const criado={style:{},setAttribute(){},addEventListener(){},innerHTML:''};
 const c={structuredClone,document:{addEventListener(){},getElementById:id=>id==='anoChip'?(depois[0]||null):el(id),createElement:()=>criado,querySelector:()=>null,querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 const run=s=>vm.runInContext(s,c);run("state.periodo='Ago/2026';state.records=[{label:'Ago/2026'}];state.cfg={demonstrativosCompetencia:{meses:{Ago_2026:{label:'Ago/2026'}}}};state.view='dre';dreUI.base='caixa';periodoOptions()");
 assert.equal(depois.length,1);assert.equal(depois[0].id,'anoChip');assert.match(criado.innerHTML,/title="2026: de janeiro até o último mês com dados">Ano</);
 run("dreUI.base='competencia';periodoOptions()");
 assert.match(els.monthChips.innerHTML,/data-period="Ago\/2026"[^>]*class="has-data apurado" title="Ago\/2026 · Apuração cadastrada">Ago<\/button>/);
 assert.match(els.monthChips.innerHTML,/class="no-data" title="Jul\/2026 · Sem apuração">Jul<\/button>/);assert.doesNotMatch(els.monthChips.innerHTML,/✓/);
 run("dreUI.base='caixa';periodoOptions()");assert.doesNotMatch(els.monthChips.innerHTML,/apurado/,'no caixa, sem marca de apuração');
 assert.equal(run('METADATA_TELAS.dre[1]'),'Movimento de caixa e resultado por competência, por mês ou no ano.');
});
// v135 (N18): o logo leva ao Dashboard pelo próprio app (sem navegar pelo href), com o Ano como estava.
test('logo leva ao Dashboard sem trocar a página e mantém o Ano',async()=>{
 const {c,run}=telaRender();const marca={};c.__qs=s=>s==='.brand'?marca:null;c.window={addEventListener(){}};c.history={state:null,replaceState(){},pushState(){}};c.document.body.classList={toggle(){},contains:()=>false};
 c.location.hash='#tela=detalhe&conta=2.4&ano=1';run('initApp()');assert.deepEqual([run('state.view'),run('state.anoTodo'),run('state.contaSelecionada')],['detalhe',true,'2.4']);await new Promise(r=>setTimeout(r,0));
 assert.equal(typeof marca.onclick,'function');let impediu=false;run("__renders=0;const __r=render;render=()=>{__renders++;__r()}");
 marca.onclick({preventDefault(){impediu=true;}});
 assert.equal(impediu,true,'o href não navega: a rota é gravada pelo render');assert.equal(run('state.view'),'inicio');assert.equal(run('state.anoTodo'),true);assert.equal(run('__renders'),1);
});
