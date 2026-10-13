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

