// Ano em todas as telas com meses e a escolha do ano de comparação (pedido do dono: "eu quero ano em todos os
// locais que tiver meses e também seleção de comparativo de ano"; "ele alimenta os próximos anos quando ele vier").
// Percorre cada tela do Ano com a base sintética do portão visual (2024, 2025 e 2026 até Set em andamento), troca o
// ano comparado (padrão, 2024, Sem comparação), faz a ida e volta do link e simula a virada para 2027.
import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {test} from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
const RAIZ=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ler=f=>fs.readFileSync(path.join(RAIZ,f),'utf8');
const fx=await import(pathToFileURL(path.join(RAIZ,'tests/visual/fixture.mjs')).href);
const {consultarGiro}=await import(pathToFileURL(path.join(RAIZ,'supabase/functions/dre-sync/giro.mjs')).href);
const M=await import(pathToFileURL(path.join(RAIZ,'indicadores-modelo.mjs')).href);
const SCRIPTS=['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js','plano-contas.js','comparativos.js','fechamento.js','auditoria.js'];
const MESES='Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez';

// Relógio do contexto parado (o app lê new Date() em dfcHoje, mesHoje e F.qualidade).
const relogio=iso=>{const t=Date.parse(iso);return class extends Date{constructor(...a){if(a.length)super(...a);else super(t);}static now(){return t;}};};
function app({registros,cfg={},agora=fx.AGORA.toISOString(),giro=null}){
 const els={},el=id=>els[id]??={id,innerHTML:'',textContent:'',value:'',hidden:false,open:false,style:{},dataset:{},classList:{toggle(){},add(){},remove(){},contains:()=>false},setAttribute(){},getAttribute:()=>null,addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],focus(){}};
 const c={structuredClone,Date:relogio(agora),document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,getElementById:el,createElement:()=>el('novo')},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout:()=>0,clearTimeout(){},__hist:[]};
 c.history={replaceState:(a,b,h)=>c.__hist.push(h),pushState:(a,b,h)=>c.__hist.push(h),state:null};
 vm.createContext(c);for(const f of SCRIPTS)vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.els=els;
 c.__r=structuredClone(registros);c.__cfg=structuredClone(cfg);c.__giro=giro;
 c.run(`render=()=>{};window={};state.records=__r;state.cfg=__cfg;state.permissoes={leitura:true,edicao:true,admin:true};if(__giro){giroUI.dados=__giro;giroUI.busy=false;carregarGiro=()=>{};}`);
 return c;
}
// Tela no Ano: o HTML que o app desenha (sem os Comparativos anuais, que são a comparação de todos os anos e
// ficam com o ano anterior mesmo em "Sem comparação", plano 4.12) e o texto sem marcação.
function desenhar(c,tela,anoComparar,extra=''){
 c.run(`state.view=${JSON.stringify(tela)};state.anoComparar=${JSON.stringify(anoComparar)};ligarAno(true);alinharAno();${extra}`);
 const html=c.run('paginasDoApp()[state.view](regAtual(),F.qualidade(regAtual()))');
 return {html,texto:html.replace(/<[^>]+>/g,' ').replace(/&nbsp;|\s+/g,' ')};
}
// Onde um ano aparece COMO ano comparado: "contra 2025", "Diferença para 2025", "2025 · Jan a Ago", "Mesmos meses de 2025",
// "Δ 2026 × 2025", "Fim de Ago/2025", "2025 (Jan a Ago)", "Comparar: 2025".
const comoComparado=(texto,ano)=>[...texto.matchAll(new RegExp(`contra (fim de )?((${MESES})/)?${ano}|para ${ano}|${ano} · (${MESES}|ano inteiro)|(meses|período) de ${ano}|× ${ano}|fim de (${MESES})/${ano}|${ano} \\(|Comparar: ${ano}`,'gi'))].map(m=>m[0]);

const REGS=fx.registros(),CFG=fx.configuracao(REGS),GIRO=await consultarGiro(fx.bancoFalso(),{},fx.AGORA);
const base=()=>{const c=app({registros:REGS,cfg:CFG,giro:GIRO});c.run(`dfcHoje=()=>'2026-09-22';state.periodo='Ago/2026';state.anoTodo=false`);return c;};
const VARIANTES={detalhe:[['dashboard',"planoUI.aba='dashboard';planoUI.juntas=null"],['planilha',"planoUI.aba='planilha';planoUI.juntas=null"],['juntas',"planoUI.aba='dashboard';planoUI.juntas=true"]]};

test('fixture do portão: 2024 entrou com 12 meses fechados e posições, sem mudar um número de 2025 e 2026',async()=>{
 const doAno=y=>REGS.filter(r=>r.label.endsWith('/'+y));
 assert.equal(doAno(2024).length,12);assert.equal(doAno(2025).length,12);assert.equal(doAno(2026).length,9);
 for(const r of doAno(2024))assert.equal(r.qualidade.ate,new Date(Date.UTC(+r.label.split('/')[1],fx.MES.indexOf(r.label.split('/')[0])+1,0)).toISOString().slice(0,10),'coletado até o último dia: '+r.label);
 const v=(r,c)=>r.cells.find(x=>x.code===c)?.value;
 assert.notEqual(v(doAno(2024)[0],'1'),v(doAno(2025)[0],'1'),'2024 tem números próprios');
 // Os números de 2025 e 2026 (registros, parâmetros, posições e O.S.) iguais aos de antes de 2024 entrar.
 const de25=x=>!/2024/.test(x),so=o=>Object.fromEntries(Object.entries(o).filter(([k])=>de25(k))),h=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,16);
 const p=fx.configuracao().parametros,b=fx.bancoFalso();
 const pos=(await b.from('dre_registros').select().eq('colecao','posicoes')).data,ord=(await b.from('painel_ordens').select()).data;
 assert.deepEqual({registros:h(REGS.filter(r=>de25(r.label))),parametros:h([so(p.simples),so(p.operacao),so(p.balanco)]),posicoes:h(pos.filter(x=>de25(x.id))),ordens:h(ord)},
  {registros:'f364169d746e1387',parametros:'94f0080d649eca55',posicoes:'341913cb6e638ca4',ordens:'429415ba516850b5'});
 assert.equal(pos.filter(x=>x.id.startsWith('2024-')).length,12,'posição do fim de cada mês de 2024');
 assert.equal(CFG.parametros.operacao['2025-01'].saldoInicial,80000,'o saldo de Jan/2025 continua o mesmo');
});

test('portão visual: estados do Ano em toda tela com meses, com 2024 escolhido e sem comparação',async()=>{
 const {ESTADOS}=await import(pathToFileURL(path.join(RAIZ,'tests/visual/base.mjs')).href);
 const c=base(),telas=c.json('ANO_TELAS'),ano=ESTADOS.filter(e=>e.ano);
 for(const t of telas)assert.ok(ano.some(e=>e.tela===t&&!e.anocomp),'estado do Ano com o ano padrão: '+t);
 for(const t of ['inicio','cfo','dre','dfc','caixa','custos','balanco','precos','detalhe','indicadores'])assert.ok(ano.some(e=>e.tela===t&&e.anocomp==='2024'),'Ano com 2024: '+t);
 assert.equal(ano.filter(e=>e.tela==='detalhe'&&e.anocomp==='2024').length,2,'Plano de contas: juntas e planilha');
 for(const t of ['inicio','detalhe'])assert.ok(ano.some(e=>e.tela===t&&e.anocomp==='nenhum'),'Sem comparação: '+t);
 assert.equal(new Set(ESTADOS.map(e=>e.tela+'|'+e.estado)).size,ESTADOS.length,'nome de estado repetido');
 assert.ok(ano.every(e=>e.periodo==='Ago/2026'),'o Ano parte de um mês fechado');
});

test('cada tela do Ano desenha o ano sem número quebrado, com o ano comparado certo (padrão, 2024 e sem comparação)',()=>{
 const c=base(),telas=c.json('ANO_TELAS').filter(t=>t!=='indicadores'),comparam=c.json('ANO_TELAS_COMPARAM'),SEM=c.run('TEXTO_SEM_ANO_COMPARADO');
 assert.ok(telas.length>=12);
 c.run('renderComparativos=()=>""');
 for(const tela of telas)for(const [variante,extra] of VARIANTES[tela]||[['','']])for(const [ac,esperado] of [['',2025],['2024',2024],['nenhum',null]]){
  const onde=`${tela}${variante?' ('+variante+')':''} com anoComparar=${JSON.stringify(ac)}`;
  let r;assert.doesNotThrow(()=>{r=desenhar(c,tela,ac,extra);},onde);
  assert.equal(c.run('state.periodo'),'Set/2026',onde+': o Ano vai ao último mês com dados');
  assert.equal(c.run('anoComparado()'),esperado,onde);
  assert.match(r.texto,/2026/,onde+': mostra o ano');
  assert.doesNotMatch(r.texto,/NaN|undefined|Infinity|R\$ -/,onde);
  const outros=[2024,2025].filter(y=>y!==esperado).flatMap(y=>comoComparado(r.texto,y));
  if(!comparam.includes(tela)){assert.deepEqual([...outros,...(esperado?comoComparado(r.texto,esperado):[])],[],onde+': a tela não compara com outro ano');continue;}
  assert.deepEqual(outros,[],onde+': nenhum outro ano como comparado');
  if(esperado)assert.ok(comoComparado(r.texto,esperado).length,onde+': diz o ano comparado');
  // Composição do caixa: sem ano escolhido, a faixa de comparação some (como no mês sem "Comparar com").
  else if(tela!=='resultado')assert.ok(r.texto.includes(SEM),onde+': diz que não há ano escolhido');
 }
});

test('o seletor do topo no Ano: anos com dados (mais recente primeiro), padrão o anterior; Conferência e Parâmetros não comparam',()=>{
 const c=base();c.run("state.view='inicio';selecionarAno('2026')");
 assert.deepEqual(c.json('[state.periodo,anosComparaveis(),anoPadraoComparado(),anoComparado()]'),['Set/2026',[2025,2024],2025,2025]);
 c.run('periodoOptions()');
 const opcoes=h=>[...h.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(m=>[m[2],/selected/.test(m[1])]);
 assert.deepEqual(opcoes(c.els.compareSelect.innerHTML),[['Sem comparação',false],['2025',true],['2024',false]]);
 assert.equal(c.els.compareSummary.textContent,'Comparar: 2025');
 c.run("selecionarAnoComparado('2024');periodoOptions()");assert.equal(c.run('state.anoComparar'),'2024');assert.equal(c.els.compareSummary.textContent,'Comparar: 2024');
 c.run("selecionarAnoComparado('2025')");assert.equal(c.run('state.anoComparar'),'','o ano anterior é o padrão');
 c.run("selecionarAnoComparado('nenhum');periodoOptions()");assert.deepEqual(opcoes(c.els.compareSelect.innerHTML)[0],['Sem comparação',true]);assert.equal(c.els.compareSummary.textContent,'Comparação');
 c.run("state.anoComparar='1999'");assert.equal(c.run('anoComparado()'),2025,'ano sem dados volta ao padrão');
 assert.deepEqual(c.json("[ANO_TELAS_COMPARAM.includes('conferencia'),ANO_TELAS_COMPARAM.includes('parametros'),ANO_TELAS.filter(t=>!ANO_TELAS_COMPARAM.includes(t))]"),[false,false,['conferencia','parametros']]);
 // fora do Ano, "Comparar com" continua com os meses
 c.run("selecionarPeriodo('Ago/2026');periodoOptions()");assert.ok(opcoes(c.els.compareSelect.innerHTML).some(([t])=>t==='Jul/2026'),'meses no modo mês');
 assert.ok(!opcoes(c.els.compareSelect.innerHTML).some(([t])=>/^\d{4}$/.test(t)));
});

test('as comparações do Ano usam os mesmos meses completos nos dois anos e somam em centavos',()=>{
 const c=base();c.run("state.view='inicio';selecionarAno('2026')");
 assert.deepEqual(c.json('mesesComparaveisAno(2026,2024)'),[0,1,2,3,4,5,6,7],'Set/2026 em andamento fica fora');
 assert.equal(c.run('rotuloMesesAno(mesesComparaveisAno(2026,2024))'),'Jan a Ago');
 assert.equal(c.run('rotuloMesesAno(mesesComparaveisAno(2025,2024))'),'ano inteiro');
 const k=c.json('(()=>{const x=comparacaoDoAno(2026,2024);return {ano:x.ano,anoComp:x.anoComp,meses:x.meses,motivo:x.motivo,a:F.valorConta(x.atual,"1"),b:F.valorConta(x.anterior,"1")}})()');
 const soma=(y,n)=>REGS.filter(r=>r.label.endsWith('/'+y)&&fx.MES.indexOf(r.label.split('/')[0])<n).reduce((s,r)=>s+Math.round(r.cells.find(x=>x.code==='1').value*100),0)/100;
 assert.deepEqual(k,{ano:2026,anoComp:2024,meses:'Jan a Ago',motivo:'',a:soma(2026,8),b:soma(2024,8)});
 c.run("state.anoComparar='nenhum'");assert.equal(c.run('comparacaoDoAno().motivo'),c.run('TEXTO_SEM_ANO_COMPARADO'));
});

test('link: anocomp vai e volta em toda tela do Ano; o padrão não vai ao link; fora do Ano fica comparar=<mês>',()=>{
 const c=base(),telas=c.json('ANO_TELAS');
 const gravar=()=>{c.run("rotaLida=true;rotaAtual='';__hist.length=0;location={hash:''};gravarRota()");return c.run('__hist.at(-1)')||'';};
 const restaurar=h=>{c.run(`state.anoComparar='';state.anoTodo=false;location={hash:${JSON.stringify(h)}};restaurarRota()`);return c.json('[state.view,state.anoTodo,state.anoComparar]');};
 for(const tela of telas)for(const ac of ['2024','nenhum','']){
  c.run(`state.view=${JSON.stringify(tela)};state.periodo='Set/2026';state.anoTodo=true;state.anoComparar=${JSON.stringify(ac)};gestaoUI.dre='ano'`);
  const h=gravar(),q=new URLSearchParams(h.slice(1));
  assert.equal(q.get('ano'),'1',tela);assert.equal(q.get('anocomp'),ac||null,`${tela}: anocomp=${ac||'(padrão fora do link)'}`);
  assert.deepEqual(restaurar(h),[tela,true,ac],tela+': volta igual depois de recarregar');
 }
 c.run("state.view='inicio';state.periodo='Ago/2026';state.anoTodo=false;state.anoComparar='2024';state.comparar='Jul/2026'");
 const m=new URLSearchParams(gravar().slice(1));assert.deepEqual([m.get('ano'),m.get('anocomp'),m.get('comparar')],[null,null,'Jul/2026'],'no mês: comparar=<mês>, sem anocomp');
 c.run("state.view='giro';state.anoTodo=true;state.anoComparar='2024'");assert.equal(new URLSearchParams(gravar().slice(1)).get('anocomp'),null,'tela sem o Ano não grava');
 assert.deepEqual(restaurar('#tela=inicio&mes=Set%2F2026&ano=1&anocomp=xyz'),['inicio',true,''],'anocomp inválido vira o padrão');
 assert.deepEqual(restaurar('#tela=inicio&mes=Set%2F2026&ano=1&anocomp=1999'),['inicio',true,'1999'],'guardado como veio');assert.equal(c.run('anoComparado()'),2025,'quem valida é anoComparado()');
});

test('Indicadores: o mesmo intervalo levado ao ano escolhido',()=>{
 assert.deepEqual(M.periodoNoAno({de:'2024-02-01',ate:'2024-02-29'},2023),{de:'2023-02-01',ate:'2023-02-28'});
 assert.deepEqual(M.periodoNoAno({de:'2026-01-01',ate:'2026-08-31'},2024),{de:'2024-01-01',ate:'2024-08-31'});
 assert.deepEqual(M.periodoAnterior({de:'2026-01-01',ate:'2026-08-31'}),{de:'2025-01-01',ate:'2025-08-31'});
 const p={de:'2026-01-01',ate:'2026-08-31'},com=M.compararAno(REGS,p,'recebimentos',{},{ano:2024}),padrao=M.compararAno(REGS,p,'recebimentos');
 assert.equal(com.disponivel,true);assert.deepEqual(com.periodo,{de:'2024-01-01',ate:'2024-08-31'});
 // 2025 contra o padrão (2024) dá os totais de Jan a Ago de 2025 e de 2024 por outro caminho
 const ref=M.compararAno(REGS,{de:'2025-01-01',ate:'2025-08-31'},'recebimentos');
 assert.equal(com.anterior,ref.anterior,'o lado comparado é 2024');assert.equal(padrao.anterior,ref.atual,'sem ano: o anterior');
 assert.notEqual(com.anterior,padrao.anterior);assert.equal(com.atual,padrao.atual);
});

// ── Virada do ano: nada de ano escrito; 2027 entra pelos dados e pelo relógio ──────────────────────
const cel=(code,name,value)=>({code,name,value});
const mes=k=>[cel('1','Entradas',10000*k),cel('1.1','Comunicação visual',10000*k),cel('1.1.1','Produtos vendidos',10000*k),cel('2','Saídas',7000*k),cel('2.1','Despesas com pessoal',2000*k),cel('2.1.4','Salários',2000*k),cel('2.4','Impostos',1000*k),cel('2.4.1','DAS',600*k),cel('2.4.1.2','DAS Impresilk',600*k),cel('2.4.8','ISSQN',400*k),cel('2.12','Materiais e insumos',4000*k),cel('2.12.1','Lonas e vinis',4000*k)];
const fimMes=(y,m)=>new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
const regMes=(y,m,k,ate=fimMes(y,m),coletadoEm=`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-02T09:00:00Z`)=>({id:`${fx.MES[m-1]}_${y}`,label:`${fx.MES[m-1]}/${y}`,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',atualizadoEm:coletadoEm,qualidade:{de:`${y}-${String(m).padStart(2,'0')}-01`,ate,coletadoEm,apiContratoValidado:true,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:mes(k),pendencias:[],eventos:[]});
const VIRADA=[...[2025,2026].flatMap(y=>Array.from({length:12},(_,i)=>regMes(y,i+1,1+(y-2025)*.1+i*.05))),regMes(2027,1,.5,'2027-01-14','2027-01-15T10:00:00-03:00')];

test('virada para 2027 (15/01/2027, Jan/2027 até 14/01): o ano novo entra sozinho no seletor, no Ano e no comparativo',()=>{
 const c=app({registros:VIRADA,cfg:{parametros:{operacao:{'2025-01':{saldoInicial:50000}}}},agora:'2027-01-15T12:00:00-03:00'});
 assert.equal(c.run('dfcHoje()'),'2027-01-15','o relógio do app é o do contexto');assert.equal(c.run('anoDeHoje()'),2027);
 c.run("state.view='inicio';state.periodo='Dez/2026';state.anoTodo=false;periodoOptions()");
 assert.deepEqual([...c.els.yearSelect.innerHTML.matchAll(/<option[^>]*>(\d{4})<\/option>/g)].map(m=>m[1]),['2027','2026','2025']);
 c.run("selecionarAno('2027')");
 assert.deepEqual(c.json('[state.periodo,state.anoTodo,rotuloAno(),anosComparaveis(),anoComparado()]'),['Jan/2027',true,'2027 · Jan*',[2026,2025],2026]);
 c.run('periodoOptions()');
 assert.deepEqual([...c.els.compareSelect.innerHTML.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m=>m[1]),['Sem comparação','2026','2025']);
 assert.equal(c.run('comparacaoDoAno().motivo'),c.run('textoSemMesesComparaveis(2027,2026)'),'Jan/2027 em andamento: nada a comparar ainda');
 assert.equal(c.run('textoSemMesesComparaveis(2027,2026)'),'Sem meses completos, da mesma base e com plano de contas em 2027 e 2026 para comparar.');
 c.run('renderComparativos=()=>""');
 for(const tela of c.json('ANO_TELAS').filter(t=>t!=='indicadores')){
  let r;assert.doesNotThrow(()=>{r=desenhar(c,tela,'');},tela);
  assert.equal(c.run('state.periodo'),'Jan/2027',tela);
  assert.match(r.texto,/2027/,tela+': mostra 2027');assert.doesNotMatch(r.texto,/NaN|undefined|Infinity|R\$ -/,tela);
 }
 for(const tela of ['inicio','cfo','caixa'])assert.ok(desenhar(c,tela,'').texto.includes('2027 · Jan*'),tela+': "2027 · Jan*"');
 c.run("state.view='inicio';selecionarAno('2026')");
 assert.deepEqual(c.json('[state.periodo,anoComparado(),rotuloMesesAno(mesesComparaveisAno(2026,2025)),rotuloAno()]'),['Dez/2026',2025,'ano inteiro','2026 · Jan a Dez']);
});
