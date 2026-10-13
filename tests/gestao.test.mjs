import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
function context(){const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true}};vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);c.run=s=>vm.runInContext(s,c);c.run("state.periodo='Fev/2026';state.permissoes.admin=true;state.cfg={};");return c;}
test('acumulado interrompe em mudança de escopo e no mês selecionado',()=>{const c=context();const values=c.run(`state.records=['Jan','Fev','Mar'].map((m,i)=>({label:m+'/2026',company:i===0?'Impresilk':'Impresilk + Universo',basis:'Caixa',cells:[{code:'1',value:100}]}));acumularAno('1').map(x=>x.acumulado)`);assert.equal(values[0],null);assert.equal(values[1],null);assert.equal(values[2],null);c.run("state.records.forEach(r=>r.company='Impresilk + Universo')");const r=c.run("acumularAno('1')");assert.equal(r[1].acumulado,200);assert.equal(r[2].acumulado,null);});
test('filtro de contas compartilhado conserva hierarquia, acentos e zero',()=>{const c=context();const rows=c.run(`state.consulta='agua';state.tipo='2';state.grupo='2.5';filtrarContas({cells:[{code:'2.5.1',name:'Água',value:0},{code:'20.5.1',name:'Água',value:10},{code:'2.6.1',name:'Água',value:20}]})`);assert.equal(rows.length,1);assert.equal(rows[0].value,0);});
test('salvar orçamento mantém competência e regras e registra versão',async()=>{const c=context();let saved;c.api=async(action,b)=>action==='getCfg'?{ok:true,cfg:{demonstrativosCompetencia:{preservado:true},gestao:{outro:{valor:1}}},atualizadoEm:'a'}:(saved=b,{ok:true,atualizadoEm:'b'});await c.run("salvarGestao('orcamento:Fev_2026',{entradas:100,saidas:80})");assert.equal(saved.baseAtualizadoEm,'a');assert.equal(saved.cfg.demonstrativosCompetencia.preservado,true);assert.equal(saved.cfg.gestao.outro.valor,1);assert.equal(saved.cfg.gestao.historico.length,1);assert.equal(c.run("state.cfg.gestao['orcamento:Fev_2026'].entradas"),100);});
test('alteração concorrente conserva edição e não sobrescreve nuvem',async()=>{const c=context();let writes=0;c.api=async(action)=>{if(action==='setCfg')writes++;return {ok:true,cfg:{gestao:{plano:{saldo:300}}}};};await assert.rejects(c.run("salvarGestao('plano',{saldo:100},null)"),/mudou na nuvem/);assert.equal(writes,0);});
test('erro de gravação não apresenta estado não salvo como confirmado',async()=>{const c=context();c.api=async a=>a==='getCfg'?{ok:true,cfg:{}}:{erro:'indisponível'};await assert.rejects(c.run("salvarGestao('alertas',{horas:24})"),/não confirmada/);assert.equal(c.run('state.cfg.gestao'),undefined);});
test('leitor não altera planejamento nem chama servidor para gravar',async()=>{const c=context();c.run('state.permissoes.admin=false');c.api=()=>{throw Error('não deve chamar');};await assert.rejects(c.run("salvarGestao('plano',{saldo:100})"),/administrativo/);});
test('ação conserva histórico de resolução e reabertura, sem mudar meses',async()=>{const c=context();let cfg={};c.api=async(a,b)=>a==='getCfg'?{ok:true,cfg:structuredClone(cfg),atualizadoEm:'x'}:(cfg=structuredClone(b.cfg),{ok:true,atualizadoEm:'x'});await c.run("salvarGestao('acao:Fev_2026:1',{titulo:'Conferência',situacao:'Resolvida',notas:'Conferido'})");await c.run("salvarGestao('acao:Fev_2026:1',{titulo:'Conferência',situacao:'Em análise',notas:'Nova evidência'})");assert.equal(cfg.gestao.historico.length,2);assert.equal(cfg.gestao.historico[1].anterior.situacao,'Resolvida');assert.equal(c.run('state.records.length'),0);});
test('competência de empresas diferentes não recebe variação',()=>{const c=context();const html=c.run(`celulaComparativo({competencia:true,ate:2,cols:[{comp:{company:'A'}},{comp:{company:'B'}}],valores:[{liquida:100,bruto:20},{liquida:100,bruto:40}]},{id:'bruto',tipo:'result'})`);assert.doesNotMatch(html,/\+100/);});
test('origem gerencial exige versão, vínculo exato e total conciliado',()=>{const c=context();const r={cells:[{code:'2.5',value:100}],trilhaClassificacao:{versao:'caixa-trilha-1',de:'2026-09-01',ate:'2026-09-30'},eventos:[{natureza:'saida',contaGerencial:'2.5.1',regraClassificacao:'caixa-trilha-1',valor:40},{natureza:'saida',contaGerencial:'2.5.2',regraClassificacao:'caixa-trilha-1',valor:60},{natureza:'saida',contaGerencial:'2.50',regraClassificacao:'caixa-trilha-1',valor:99}]};c.r=r;assert.equal(c.run("DRECFO.origem(r,'2.5').eventos.length"),2);r.eventos[1].valor=59;assert.equal(c.run("DRECFO.origem(r,'2.5').disponivel"),false);r.eventos[1].valor=60;delete r.trilhaClassificacao;assert.equal(c.run("DRECFO.origem(r,'2.5').disponivel"),false);});

test('PDF de contas contém só o recorte, filtros e comparação, sem relatório geral',()=>{const c=context();const r=c.run(`state.consulta='Cemig';state.tipo='2';state.grupo='todos';state.comparar='Jan/2026';state.records=['Jan','Fev'].map((m,i)=>({label:m+'/2026',company:'Impresilk',basis:'Caixa',cells:[{code:'1',name:'Entradas',value:1000},{code:'2',name:'Saídas',value:800},{code:'2.5.3',name:'Cemig',value:100+i*20},{code:'2.5.4',name:'Água',value:50}]}));relatorioCFO({tipo:'contas'})`);assert.equal(r.blocos.length,1);assert.equal(r.blocos[0].linhas.length,1);assert.equal(r.blocos[0].linhas[0][1],'Cemig');assert.equal(r.blocos[0].linhas[0].length,5);assert.ok(r.notas.some(n=>n.includes('busca Cemig')&&n.includes('saídas')));assert.doesNotMatch(JSON.stringify(r.blocos),/Água|Retrato do período|Onde investigar/);});

test('histórico mensal mostra bases distintas com identificação sem alterar o acumulado',()=>{const c=context();const html=c.run(`gestaoUI.serie='entradas';state.periodo='Fev/2026';state.records=['Jan','Fev'].map((m,i)=>({label:m+'/2026',company:i?'Impresilk + Universo':'Impresilk',basis:'Caixa',cells:[{code:'1',value:100+i}]}));evolucaoCompacta()`);assert.match(html,/Jan\/2026/);assert.match(html,/Impresilk/);assert.match(html,/100,00/);assert.equal(c.run("acumularAno('1')[1].acumulado"),null);});
// v133 (C2): saídas em quatro tons da família vermelha (--g-risco-1..4); grupos fixos sempre com o mesmo tom.
test('cores de categorias são distintas e estáveis entre os dois gráficos',()=>{const c=context();const cores=c.run("['2.14','2.1','2.12','2.4'].map(id=>corCategoria(id))");assert.equal(new Set(cores).size,4);assert.ok(cores.every(x=>/--g-risco-[1-4]/.test(x)));assert.equal(new Set(Object.values(c.run("coresCategorias(['2.14','2.1','2.2','2.6'])"))).size,4,'sem repetir até quatro grupos');assert.equal(c.run("corCategoria('2.1',4)"),c.run("corCategoria('2.1',0)"));});

// Ordem de chaves do jsonb do Postgres: por tamanho, depois por bytes.
const jsonb=v=>Array.isArray(v)?v.map(jsonb):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)).map(k=>[k,jsonb(v[k])])):v;
// Nuvem simulada: getCfg devolve o cfg na ordem do jsonb; setCfg recusa base velha.
function nuvem(c){const n={cfg:{},em:'t0',writes:0};c.api=async(a,b)=>{if(a==='getCfg')return {ok:true,cfg:jsonb(structuredClone(n.cfg)),atualizadoEm:n.em};if(b.baseAtualizadoEm!==n.em)return {conflito:true};n.cfg=structuredClone(b.cfg);n.em+='+';n.writes++;return {ok:true,atualizadoEm:n.em};};return n;}
test('salvar de novo na mesma sessão não acusa conflito só porque o jsonb reordenou as chaves',async()=>{
 const c=context();const n=nuvem(c);
 // Revisão de ação usa o original padrão; orçamento e cenário, uma cópia do state.cfg depois da gravação.
 await c.run("salvarGestao('acao:Fev_2026:1',{titulo:'Conferência',situacao:'Resolvida',responsavel:'Ana',notas:'Conferido'})");
 await c.run("salvarGestao('acao:Fev_2026:1',{titulo:'Conferência',situacao:'Em análise',responsavel:'Ana',notas:'Nova evidência'})");
 await c.run("salvarGestao('orcamento:Fev_2026',{entradas:1000,saidas:800,variacao:200,fonte:'Reunião'})");
 await c.run("salvarGestao('orcamento:Fev_2026',{entradas:1000,saidas:700,variacao:300,fonte:'Reunião'},structuredClone(state.cfg.gestao['orcamento:Fev_2026']))");
 // O plano passa o item devolvido como original, com objetos dentro da lista de movimentos.
 c.base=await c.run("salvarGestao('plano',{saldo:1000,reserva:200,inicio:'2026-02-01',cenario:1,movimentos:[{descricao:'Aluguel',valor:-500,data:'2026-02-10'}]})");
 await c.run("salvarGestao('plano',{...base,saldo:900},base)");
 assert.equal(n.writes,6);assert.equal(n.cfg.gestao.historico.length,6);
 assert.equal(n.cfg.gestao['acao:Fev_2026:1'].situacao,'Em análise');assert.equal(n.cfg.gestao['orcamento:Fev_2026'].saidas,700);assert.equal(n.cfg.gestao.plano.saldo,900);
});
test('mudança de verdade na nuvem continua recusada, inclusive a ordem dos itens de uma lista',async()=>{
 const c=context();const n=nuvem(c);
 await c.run("salvarGestao('alertas',{horas:24,variacao:500})");
 n.cfg.gestao.alertas.horas=48;n.em+='*';
 await assert.rejects(c.run("salvarGestao('alertas',{horas:12,variacao:500})"),/mudou na nuvem/);
 c.run("state.cfg.gestao.alertas.horas=48");
 await c.run("salvarGestao('plano',{saldo:1000,movimentos:[{descricao:'Aluguel',valor:-500},{descricao:'Luz',valor:-80}]})");
 n.cfg.gestao.plano.movimentos.reverse();n.em+='*';
 await assert.rejects(c.run("salvarGestao('plano',{saldo:900,movimentos:[]})"),/mudou na nuvem/);
 assert.equal(n.writes,2);assert.equal(n.cfg.gestao.alertas.horas,48);assert.equal(n.cfg.gestao.plano.movimentos[0].descricao,'Luz');
});

// v133: cor das variações, termo único das pendências, nomes do menu e histórico do navegador.
function ctxRota(hash='#tela=inicio&mes=Fev%2F2026'){
 const ouvintes={},hist=[],dlg={open:false,fechou:0,aoFechar:[],close(){this.open=false;this.fechou++;},addEventListener(t,f){if(t==='close')this.aoFechar.push(f);}};
 const c={structuredClone,URLSearchParams,window:{addEventListener(t,f){ouvintes[t]=f;}},document:{addEventListener(){},getElementById:id=>id==='detailDialog'?dlg:null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash},
  history:{state:null,pushState(s,_,u){hist.push(['push',u]);this.state=s;c.location.hash=u;},replaceState(s,_,u){hist.push(['replace',u]);this.state=s;c.location.hash=u;}}};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','cfo-modelo.js','cfo.js','app.js','gestao.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 c.run=s=>vm.runInContext(s,c);
 // As duas marcas são do app.js; se ele ainda não as declarar, o teste cria.
 c.run("if(typeof fechandoPorVoltar==='undefined'){globalThis.fechandoPorVoltar=false;globalThis.voltandoHistorico=false;}globalThis.__renders=[];render=()=>__renders.push(voltandoHistorico);restaurarRota();");
 return {c,ouvintes,hist,dlg};
}
test('Voltar com o diálogo aberto só fecha o diálogo; Voltar de tela redesenha sem forçar o topo (N1, N2)',()=>{
 const {c,ouvintes,dlg}=ctxRota();
 dlg.open=true;ouvintes.popstate();
 assert.equal(dlg.fechou,1,'fecha o diálogo');assert.equal(c.run('__renders.length'),0,'tela e rota ficam como estão');
 assert.equal(c.run('fechandoPorVoltar'),true,'o close ainda vai chegar: a marca segue ligada');dlg.aoFechar.forEach(f=>f());assert.equal(c.run('fechandoPorVoltar'),false,'depois do close a marca desliga');
 ouvintes.popstate();assert.equal(c.run('__renders.length'),0,'mesma URL (a entrada do diálogo que fechou pelo ✕): não redesenha nem mexe no Ano');
 c.location.hash='#tela=dre&mes=Fev%2F2026';ouvintes.popstate();assert.equal(c.run('JSON.stringify(__renders)'),'[true]','sem diálogo: redesenha avisando que veio do histórico');assert.equal(c.run('state.view'),'dre');assert.equal(c.run('voltandoHistorico'),false);
});
test('fechar o diálogo pelo ✕ volta para a mesma URL: o popstate não redesenha nem desliga o Ano (N2)',()=>{
 const {c,ouvintes}=ctxRota('#tela=cfo&mes=Fev%2F2026');
 c.run('state.anoTodo=true');ouvintes.popstate();
 assert.equal(c.run('__renders.length'),0,'mesma URL: nada a restaurar');assert.equal(c.run('state.anoTodo'),true,'o Ano ligado na DRE continua ligado');
});
test('troca de tela com o diálogo aberto substitui a entrada do diálogo; sem diálogo, empilha (N2)',()=>{
 const {c,hist}=ctxRota();
 c.history.state={dialogo:1};c.run("state.view='cfo';gravarRota()");
 assert.equal(hist.at(-1)[0],'replace','não deixa entrada a mais no histórico');assert.equal(c.history.state?.dialogo,undefined,'a marca sai: o close não volta');
 c.run("state.view='dre';gravarRota()");assert.equal(hist.at(-1)[0],'push');
});
function ctxResumo(){
 const c=context();
 c.run(`state.periodo='Fev/2026';state.comparar='Jan/2026';const cel=(code,name,value)=>({code,name,value});
 const mes=(label,e,s,fixas,fin)=>({label,company:'Impresilk',basis:'Caixa',origem:'erp',qualidade:{ate:F.periodo(label).ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:[cel('1','Entradas',e),cel('2','Saídas',s),cel('2.5','Despesas Fixas',fixas),cel('2.13','Despesas financeiras',fin)]});
 state.records=[mes('Fev/2025',900,850,400,450),mes('Jan/2026',1000,700,300,400),{...mes('Fev/2026',1200,800,500,300),pendencias:[{tipo:'Classificação',texto:'A',conta:'2.5',valor:10},{tipo:'Cobertura',texto:'B',conta:'2.5',valor:20},{tipo:'Cobertura',texto:'C',conta:'1',valor:30}]}];`);
 return c;
}
test('O que mudou: Diferença logo depois do Grupo, saída que sobe em vermelho e dívida neutra; ano anterior com os dois valores (C11, D9, I27, N15)',()=>{
 const c=ctxResumo(),h=c.run('resumoGestao(regAtual())');
 assert.match(h,/<thead><tr><th scope="col">Grupo<\/th><th scope="col" class="num">Diferença<\/th><th scope="col" class="num">Atual<\/th><th scope="col" class="num">Anterior<\/th><\/tr><\/thead>/,'I26: "Grupo" como termo único; N26: scope');assert.match(h,/variações dos grupos de saídas/);assert.doesNotMatch(h,/categorias/);
 assert.match(h,/>Despesas Fixas \(grupo 2\.5 do Mubisys\)<\/button><\/td><td class="num delta-ruim">▲ <span class="nowrap">R\$\s200,00<\/span><\/td><td class="num tom-sai">R\$\s500,00<\/td><td class="num tom-sai">R\$\s300,00<\/td>/,'despesa fixa subiu: ruim');
 assert.match(h,/>Despesas financeiras<\/button><\/td><td class="num ">▼ <span class="nowrap">R\$\s100,00<\/span><\/td>/,'2.13 é dívida: sem bom nem ruim, e sem sinal de menos ao lado da seta (C29)');
 assert.match(h,/permanecem no Plano de contas\./);assert.doesNotMatch(h,/Contas e origem/);
 assert.match(h,/Entradas menos saídas: <b class="tom-entra">R\$\s400,00<\/b> em Fev\/2026 contra <b class="tom-entra">R\$\s50,00<\/b> em Fev\/2025 \(<b class="delta-bom">▲ R\$\s350,00 a mais<\/b>\)/);
 assert.doesNotMatch(h,/Variação do caixa versus/);
 assert.match(h,/<button class="chip-warn" data-go="conferencia">3 pendência\(s\) a conferir<\/button>/,'I21: um termo só');
});
test('orçamento: desvio bom ou ruim pela direção da linha (C11)',()=>{
 const c=ctxResumo();c.run("state.cfg={gestao:{'orcamento:Fev_2026':{entradas:1000,saidas:900,variacao:100,fonte:'Teste',atualizadoEm:'2026-02-01T00:00:00Z'}}}");
 const h=c.run('tabelaOrcamento(regAtual())');
 assert.match(h,/<td>Entradas<\/td>.*?<td class="num delta-bom">▲ R\$\s200,00<\/td>/);
 assert.match(h,/<td>Saídas<\/td>.*?<td class="num delta-bom">▼ R\$\s100,00<\/td>/,'gastar menos que o limite é bom');
 assert.match(h,/<td>Entradas menos saídas<\/td>.*?<td class="num delta-bom">▲ R\$\s300,00<\/td>/);
 c.run("regAtual().qualidade.ate='2026-02-15'");const p=c.run('tabelaOrcamento(regAtual())');
 assert.doesNotMatch(p,/delta-(bom|ruim)/,'C3: mês em andamento contra o orçamento do mês cheio fica neutro');assert.match(p,/<td>Saídas<\/td>.*?<td class="num ">▼ R\$\s100,00<\/td>/,'a seta continua');
});
test('fila de conferência: "pendência(s) a conferir" e valor com o tom da conta (C25, I21)',()=>{
 const c=ctxResumo();c.run("planoTom=(code,v)=>tomDoValor(code.startsWith('1')?'entradas':code.startsWith('2')?'saidas':'',v)");
 const h=c.run('painelPendencias(regAtual())');
 assert.match(h,/3 pendência\(s\) a conferir\./);assert.doesNotMatch(h,/ocorrências/);
 assert.match(h,/<b class="tom-sai">R\$\s10,00<\/b>/);assert.match(h,/<b class="tom-entra">R\$\s30,00<\/b>/);
});
test('Veja também usa os nomes do menu, em texto, sem aria-current (N15, N16)',()=>{
 const c=context();
 assert.equal(c.run("state.view='cfo';navContexto()"),'<nav class="context-nav veja-tambem" aria-label="Veja também"><span class="muted">Veja também:</span> <button type="button" class="text-button" data-go="indicadores">Indicadores →</button> <button type="button" class="text-button" data-go="custos">Despesas e categorias →</button></nav>');
 assert.match(c.run("state.view='custos';navContexto()"),/>Análise CFO →<\/button>/);
 assert.match(c.run("state.view='resultado';navContexto()"),/>Caixa e planejamento →<\/button>/);
 assert.match(c.run("state.view='caixa';navContexto()"),/data-go="resultado">Composição do caixa →<\/button>/,'Composição do caixa alcançável a partir do Caixa');
 assert.match(c.run("state.view='conferencia';navContexto()"),/>Sistemas e configurações →<\/button>/);
 for(const v of ['cfo','custos','resultado','caixa','conferencia','config','indicadores'])assert.doesNotMatch(c.run(`state.view='${v}';navContexto()`),/aria-current/);
 for(const v of ['inicio','dre','detalhe','glossario','dfc','balanco','giro','recebiveis','precos','parametros','ajuda'])assert.equal(c.run(`state.view='${v}';navContexto()`),'',v+': sem item, sem barra');
 for(const v of ['cfo','custos','resultado','caixa','conferencia','config'])assert.doesNotMatch(c.run(`state.view='${v}';navContexto()`),/Investigar variações|Movimento e previsão|Contas e origem|>Configurações</);
});

// ── v135 ──────────────────────────────────────────────────────────────────
test('DRE compacta: AV % só na competência, p.p. com uma casa fixa e linha com scope (D16, D20, N26)',()=>{
 const c=context();c.run("state.periodo='Fev/2026';state.comparar='Jan/2026';gestaoUI.dre='mes'");
 const linhas="[{id:'entradas',nome:'Entradas',tipo:'result'},{id:'margem',nome:'Margem',tipo:'ratio'}]";
 const caixa=c.run(`tabelaDRECompacta({competencia:false,ate:2,cols:[{label:'Jan/2026'},{label:'Fev/2026'}],valores:[{entradas:100,saidas:50,margem:10},{entradas:120,saidas:60,margem:12}],linhas:${linhas},soma:{entradas:220,margem:null}})`);
 assert.doesNotMatch(caixa,/AV %|AV sobre/,'DRE de caixa sem a coluna AV % (só traços)');assert.match(caixa,/<caption>Caixa gerencial · Fev\/2026 · valores em R\$<\/caption>/);
 assert.match(caixa,/<tr class="dre-row-result"><th scope="row">Entradas<\/th>/);assert.match(caixa,/<thead><tr><th scope="col">Rubrica<\/th><th scope="col" class="num">Fev\/2026<\/th><th scope="col" class="num">Jan\/2026<\/th>/);
 const comp=c.run(`tabelaDRECompacta({competencia:true,ate:2,cols:[{label:'Jan/2026',comp:{company:'Impresilk'}},{label:'Fev/2026',comp:{company:'Impresilk'}}],valores:[{liquida:100,entradas:100,margem:10},{liquida:200,entradas:150,margem:12}],linhas:${linhas},soma:{entradas:250,margem:null}})`);
 assert.match(comp,/<caption>Competência · Fev\/2026 · valores em R\$ · AV sobre receita líquida<\/caption>/);assert.match(comp,/<th scope="col" class="num">AV %<\/th>/);
 assert.match(comp,/▲ 2,0 p\.p\./,'diferença de margem com uma casa fixa');
});
test('Fila de conferência: código do Mubisys ao lado do código do painel (I22)',()=>{
 const c=ctxResumo();c.run("regAtual().pendencias=[{tipo:'Classificação',texto:'Conta nova',conta:'2.12',valor:5},{tipo:'Classificação',texto:'Mesma',conta:'1.2',valor:6},{tipo:'Cobertura',texto:'Sem conta',valor:7}]");
 const h=c.run('painelPendencias(regAtual())');
 assert.match(h,/<small>2\.12 · Mubisys 2\.9 · A conferir<\/small>/);assert.match(h,/<small>1\.2 · A conferir<\/small>/,'código igual não ganha sufixo');assert.match(h,/<small> · A conferir<\/small>/,'sem conta, sem código');
});
test('alerta de coleta antiga só para mês ainda aberto (I23)',()=>{
 const c=context(),h=n=>new Date(Date.now()-n*36e5).toISOString();
 const fechado=c.run(`alertasPeriodo({label:'Ago/2026',origem:'erp',qualidade:{ate:'2026-08-31',coletadoEm:'${h(20*24)}'},cells:[]})`);
 assert.ok(!fechado.some(a=>/Coleta/.test(a)),'mês coletado até o último dia não envelhece');
 const aberto=c.run(`alertasPeriodo({label:'Out/2026',origem:'erp',qualidade:{ate:'2026-10-05',coletadoEm:'${h(30)}'},cells:[]})`);
 assert.ok(aberto.includes('Coleta deste mês com mais de 24h'));
 assert.ok(!c.run(`alertasPeriodo({label:'Out/2026',origem:'erp',qualidade:{ate:'2026-10-05',coletadoEm:'${h(2)}'},cells:[]})`).some(a=>/Coleta/.test(a)),'coleta recente: sem alerta');
 // mês de planilha não tem qualidade.ate: vale a data da importação (verificação v135)
 assert.ok(!c.run(`alertasPeriodo({label:'Jan/2026',origem:'planilha',atualizadoEm:'2026-02-10T12:00:00Z',qualidade:{estado:'cobertura-nao-validada'},cells:[]})`).some(a=>/Coleta/.test(a)),'planilha importada depois do fim do mês não envelhece');
 assert.ok(c.run(`alertasPeriodo({label:'Jan/2026',origem:'planilha',atualizadoEm:'2026-01-15T12:00:00Z',qualidade:{estado:'cobertura-nao-validada'},cells:[]})`).includes('Coleta deste mês com mais de 24h'),'importada no meio do mês: continua aberto');
});
test('O que mudou: grupo parado fica fora do "Demais", que diz quais grupos soma (I26)',()=>{
 const c=ctxResumo();c.run("state.records.filter(r=>r.label!=='Fev/2025').forEach(r=>r.cells.push({code:'2.7',name:'Veículos',value:50}));state.cfg={gestao:{alertas:{variacao:150}}}");
 const h=c.run('resumoGestao(regAtual())');
 assert.match(h,/<tr><td title="Despesas financeiras">Demais 1 grupo<\/td>/);assert.doesNotMatch(h,/Veículos/,'diferença zero não entra');assert.doesNotMatch(h,/categorias comparáveis/);
});
test('rota: aba e "juntas" do Plano, área e fonte dos Indicadores, sem entrada nova no histórico (N3)',()=>{
 const {c,hist}=ctxRota('#tela=detalhe&mes=Fev%2F2026&aba=planilha&juntas=1');
 c.run("globalThis.planoUI={aba:'dashboard',juntas:false};restaurarRota()");
 assert.deepEqual([c.run('planoUI.aba'),c.run('planoUI.juntas')],['planilha',true],'o link abre a aba Mês a mês');
 const n=hist.length;c.run('gravarRota()');assert.equal(hist.length,n+1);assert.equal(hist.at(-1)[0],'replace');let q0=new URLSearchParams(c.location.hash.slice(1));assert.deepEqual([q0.get('tela'),q0.get('aba'),q0.get('juntas')],['detalhe','planilha','1'],'a aba e o "juntas" seguem no link');
 c.run('gravarRota()');assert.equal(hist.length,n+1,'mesma rota: nada a gravar');
 c.run("planoUI.aba='dashboard';planoUI.juntas=null;gravarRota()");assert.equal(hist.at(-1)[0],'replace','trocar de aba substitui a entrada');
 assert.equal(new URLSearchParams(c.location.hash.slice(1)).has('aba'),false);assert.equal(new URLSearchParams(c.location.hash.slice(1)).has('juntas'),false,'automático não vai ao link');
 c.run("planoUI.juntas=false;gravarRota()");assert.equal(new URLSearchParams(c.location.hash.slice(1)).get('juntas'),'0');
 c.location.hash='#tela=detalhe&mes=Fev%2F2026';c.run('restaurarRota()');assert.deepEqual([c.run('planoUI.aba'),c.run('planoUI.juntas')],['dashboard',null]);
 // Indicadores: a área do link vale até o mount; depois, a da tela.
 const chamadas=[];c.window.DREIndicadores={area(a,f){chamadas.push([a,f]);},rota:()=>({area:'receita',fonte:'recebimentos'})};
 c.location.hash='#tela=indicadores&mes=Fev%2F2026&area=custos&fonte=compras';c.run('restaurarRota()');
 assert.deepEqual(JSON.parse(c.run('JSON.stringify(state.indicadoresRota)')),{area:'custos',fonte:'compras'});assert.deepEqual(chamadas,[['custos','compras']],'módulo já carregado: a área muda na hora');
 c.run('gravarRota()');let q=new URLSearchParams(c.location.hash.slice(1));assert.deepEqual([q.get('area'),q.get('fonte')],['custos','compras'],'antes do mount, a rota do link');
 c.window.DREIndicadores.rota=()=>({area:'custos',fonte:'notas'});const antes=hist.length;c.run('state.indicadoresRota=null;gravarRota()');q=new URLSearchParams(c.location.hash.slice(1));
 assert.deepEqual([q.get('area'),q.get('fonte')],['custos','notas']);assert.equal(hist.length,antes+1);assert.equal(hist.at(-1)[0],'replace','trocar de fonte não empilha');
 c.location.hash='#tela=dre&mes=Fev%2F2026';c.run('restaurarRota()');assert.equal(c.run('state.indicadoresRota'),null);
});
test('links profundos inválidos: comparar o próprio mês, tela inexistente e seção do Glossário (N22)',()=>{
 const {c,hist}=ctxRota('#tela=dre&mes=Fev%2F2026&comparar=Fev%2F2026');
 assert.equal(c.run('state.comparar'),'','comparar com o próprio mês abre sem comparação');
 for(const [h,esperado] of [['comparar=Xyz%2F2026',''],['comparar=',''],['comparar=Jan%2F2026','Jan/2026']]){c.location.hash='#tela=dre&mes=Fev%2F2026&'+h;c.run('restaurarRota()');assert.equal(c.run('state.comparar'),esperado,h);}
 const r2=ctxRota('#tela=inexistente&mes=Fev%2F2026');r2.c.run('gravarRota()');
 assert.deepEqual(r2.hist.map(x=>x[0]),['replace'],'tela inexistente: a primeira gravação substitui, sem entrada extra');assert.equal(r2.c.run('state.view'),'inicio');
 const r3=ctxRota('#tela=glossario&secao=painel');assert.equal(r3.c.run('state.glossarioSecao'),'painel');
 r3.c.location.hash='#tela=dre&secao=painel';r3.c.run('restaurarRota()');assert.equal(r3.c.run('state.glossarioSecao'),'','secao só no Glossário');
 assert.ok(hist.every(x=>x[0]!=='push'));
});
test('menu: tela sem item próprio abre o grupo do item-pai (N4)',()=>{
 const c=context(),vistos=[],grupo={open:false};
 c.run("if(typeof MENU_PAI==='undefined')globalThis.MENU_PAI={custos:'indicadores',resultado:'caixa'}");
 c.document.querySelector=sel=>{vistos.push(sel);return {closest:()=>grupo};};
 c.run("state.view='resultado';sincronizarMenu()");assert.equal(vistos.at(-1),'#viewTabs [data-view="caixa"]');assert.equal(grupo.open,true,'Composição do caixa abre o grupo de Caixa e planejamento');
 c.run("state.view='custos';sincronizarMenu()");assert.equal(vistos.at(-1),'#viewTabs [data-view="indicadores"]');
 c.run("state.view='dfc';sincronizarMenu()");assert.equal(vistos.at(-1),'#viewTabs [data-view="dfc"]');
});
test('"↑ Topo e menu": volta ao topo com o menu aberto e o foco no Menu (N13)',()=>{
 const c=context(),ouv={},rolou=[],estado={aberto:false,expandido:'false',focoMenu:0};
 const el=(id,extra={})=>({id,addEventListener(t,f){ouv[id+':'+t]=f;},setAttribute(k,v){if(id==='menuToggle'&&k==='aria-expanded')estado.expandido=v;},getAttribute:k=>k==='aria-expanded'?estado.expandido:null,querySelectorAll:()=>[],offsetParent:{},...extra});
 const els={viewTabs:el('viewTabs'),menuToggle:el('menuToggle',{focus(){estado.focoMenu++;}}),pageTitle:el('pageTitle'),voltarMenu:el('voltarMenu')};
 Object.assign(c.document,{getElementById:id=>els[id]||null,querySelector:s=>s==='.sidebar'?{classList:{toggle(k,v){if(k==='menu-aberto')estado.aberto=v;}},addEventListener(){}}:null});
 c.window={scrollTo:o=>rolou.push(o)};c.run('wireMenuLateral()');
 assert.equal(typeof ouv['voltarMenu:click'],'function');ouv['voltarMenu:click']();
 assert.equal(JSON.stringify(rolou),'[{"top":0}]');assert.deepEqual([estado.aberto,estado.expandido,estado.focoMenu],[true,'true',1]);
});
