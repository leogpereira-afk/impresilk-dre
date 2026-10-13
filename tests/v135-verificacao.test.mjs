// Verificação da v135: o "−" (U+2212) fica só na tela (o PDF e o CSV recebem hífen), o leitor de número aceita
// o "−" que a tela mostra, gráfico do saldo projetado no planejamento (D22) e "Ver em" do Glossário até a seção (N24).
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ARQ=['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js','plano-contas.js','comparativos.js'];
const reg=(label,ate,values)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells:Object.entries(values).map(([code,value])=>({code,name:'Conta '+code,value}))});
// Agosto fecha no vermelho e tem estorno (saída negativa): sem pdfTexto, o PDF receberia "−R$".
const REGS=[reg('Jul/2026','2026-07-31',{'1':1000,'1.1':1000,'2':800,'2.5':800,'2.5.3':800}),reg('Ago/2026','2026-08-31',{'1':1000,'1.1':1000,'2':1300,'2.5':1300,'2.5.3':-200,'2.5.4':1500})];
function ctx({view='inicio',periodo='Ago/2026',hash=''}={}){
 const elementos={};
 const c={structuredClone,URLSearchParams,document:{addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,getElementById:id=>elementos[id]||null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash},history:{state:null,pushState(){},replaceState(_,__,h){c.location.hash=h;}}};
 vm.createContext(c);for(const f of ARQ)vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.elementos=elementos;c.__r=structuredClone(REGS);
 c.run(`dfcHoje=()=>'2026-09-15';render=()=>{};toast=(m)=>{__erros.push(m)};__erros=[];state.records=__r;state.D={accounts:[]};state.cfg={};state.view=${JSON.stringify(view)};state.periodo=${JSON.stringify(periodo)};state.comparar='';state.consulta='';state.tipo='todos';state.grupo='todos';state.permissoes={leitura:true,edicao:true,admin:true}`);
 return c;
}
// jsPDF de mentira: guarda todo texto que chegaria ao gerador (texto solto, quebra de linha, tabelas e metadados).
function jsPDFFalso(){
 const textos=[];
 class Doc{constructor(){this.paginas=1;this.lastAutoTable={finalY:40};}
  setFontSize(){}setTextColor(){}setFont(){}setFillColor(){}rect(){}addPage(){this.paginas++;}setPage(){}getNumberOfPages(){return this.paginas;}save(){}
  splitTextToSize(s){textos.push(String(s));return [String(s)];}
  text(s){textos.push(...[].concat(s).map(String));}
  autoTable(o){for(const linha of [...(o.head||[]),...(o.body||[])])for(const cel of linha)textos.push(String(cel));this.lastAutoTable={finalY:60};}
  setProperties(p){textos.push(...Object.values(p).map(String));}}
 return {Doc,textos};
}

test('PDF: nenhum texto chega ao jsPDF com "−" (U+2212), nem no relatório da análise nem no Plano de contas',async()=>{
 const c=ctx();c.run("state.comparar='Jul/2026'");
 for(const tipo of ['executivo','mensal','anual','contas','custos']){
  const {Doc,textos}=jsPDFFalso();c.__Doc=Doc;c.run(`PDFCFO.montar(__Doc,relatorioCFO({tipo:${JSON.stringify(tipo)},periodo:state.periodo}))`);
  assert.ok(textos.some(t=>/-R\$|- ?\d/.test(t)),`${tipo}: o PDF tem valor negativo, com hífen`);
  assert.deepEqual(textos.filter(t=>/[−–—]/.test(t)),[],`${tipo}: sem "−", "–" ou "—" no texto do PDF`);
 }
 const conta=jsPDFFalso();c.__Doc=conta.Doc;c.run("PDFCFO.montar(__Doc,relatorioCFO({tipo:'conta',code:'2.5.3',periodo:state.periodo}))");
 assert.deepEqual(conta.textos.filter(t=>/[−–—]/.test(t)),[],'conta com estorno');
 const cen=jsPDFFalso();c.__Doc=cen.Doc;c.run("PDFCFO.montar(__Doc,relatorioCFO({tipo:'cenario',premissas:{receita:1000,custoVariavel:1500,fixos:200,meta:0},cenario:{mc:-0.5,equilibrio:null,vendaMeta:null}}))");
 assert.deepEqual(cen.textos.filter(t=>/[−–—]/.test(t)),[],'margem negativa no cenário');
 // Plano de contas (RC1): a célula da matriz passava por money() sem pdfTexto e saía ilegível.
 const plano=jsPDFFalso();c.__Plano=plano.Doc;c.run("PDFCFO.carregar=async()=>__Plano;__botao={textContent:'PDF',disabled:false}");
 await c.run('baixarPDFPlano(__botao)');
 assert.deepEqual(c.json('__erros'),[]);assert.ok(plano.textos.some(t=>/^-\s200,00$/.test(t)),'estorno de agosto com hífen');
 assert.deepEqual(plano.textos.filter(t=>/[−–—]/.test(t)),[]);
 assert.equal(c.run("pdfTexto('−R$ 1,00 → —')"),'-R$ 1,00  >  -');
});

test('leitor de número: aceita o "−" que a tela mostra, também antes do R$ (parseNum e paramNumeroBR)',()=>{
 const c=ctx();
 for(const [txt,n] of [['−1.234,56',-1234.56],['−R$ 400,00',-400],['-R$ 1.500',-1500],['R$ 1.500',1500],['− 400,00',-400],['-400,00',-400],['7,45',7.45]])assert.equal(c.run(`parseNum(${JSON.stringify(txt)})`),n,'parseNum '+txt);
 for(const [txt,n] of [['− 400,00',-400],['−R$ 1.200.000,00',-1200000],['−7,5%',-7.5],['R$ 1.500',1500],['7.45',7.45]])assert.equal(c.run(`paramNumeroBR(${JSON.stringify(txt)})`),n,'paramNumeroBR '+txt);
 assert.ok(Number.isNaN(c.run("paramNumeroBR('−abc')")));assert.equal(c.run("paramNumeroBR('')"),null);
 assert.throws(()=>c.run("parseNum('−x')"),/Valor monetário inválido/);
});

test('percentual na tela com "−" e sem "−0"; CSV volta ao hífen no sinal do número',()=>{
 const c=ctx();
 const casos=[['GX.pct(-6.14)','−6,1%'],['GX.pct(-0.04)','0,0%'],['drePct(-6.1)','−6,1%'],['drePct(-0.04)','0,0%'],['precoPct(-6.5)','−6,5%'],['precoPct(-0.04)','0,0%'],
  ['valorDRE(-6.1,true)','−6,1%'],['valorDRE(-0.04,true)','0,0%'],['cfoValor(-2.34,true)','−2,3%'],['cfoValor(-0.04,true)','0%'],['cfoPct(-73.5)','−73,5%'],['cfoPct(-0.04)','0,0%'],
  ['cmpVar(-12.34)','−12,3%'],['cmpVar(-0.04)','0,0%'],['cmpFmt(-0.04)','0,0'],['planoPctTxt(-0.04)','0,0%'],['planoPctTxt(-12.345)','−12,3%'],['paramPct(-1.5)','−1,50%'],['money(-1700)','−R$ 1.700,00']];
 for(const [exp,esperado] of casos)assert.equal(c.run(exp),esperado,exp);
 // Δ p.p. da comparação da DRE e a variação do CFO usam o mesmo sinal
 assert.doesNotMatch(c.run('renderCFO(regAtual())'),/[\s>(]-\d+,\d%/);
 assert.equal(c.run("celulaCSV('−6,1%')"),`"'-6,1%"`,'mesmo texto da v134');assert.equal(c.run("celulaCSV('−1.234,56')"),'"-1.234,56"','número que a planilha soma');
 assert.equal(c.run("celulaCSV('−R$ 10,00')"),`"'-R$ 10,00"`);assert.equal(c.run("celulaCSV('(−) DAS')"),'"(−) DAS"','rótulo fica como está');
});

test('D22: gráfico do saldo projetado semana a semana, com a reserva mínima e sem ponto onde a carga não chega',()=>{
 const c=ctx({view:'caixa'});
 const el=id=>c.elementos[id]??={innerHTML:'',textContent:'',value:''};el('planMovimentos');el('planResultado');
 c.run("plano={saldo:10000,reserva:3000,inicio:'2026-09-28',cenario:1,movimentos:[{id:'a',descricao:'Folha',data:'2026-10-05',tipo:'saida',valor:4000},{id:'b',descricao:'Fornecedor',data:'2026-10-20',tipo:'saida',valor:8000},{id:'c',descricao:'Cliente',data:'2026-11-02',tipo:'entrada',valor:5000}],carteira:{incompletas:[12,13]}}");
 c.run('mostrarPlano()');const r=c.elementos.planResultado.innerHTML;
 const fig=r.slice(r.indexOf('id="planGrafico"'),r.indexOf('</section>',r.indexOf('id="planGrafico"')));
 assert.ok(fig.length>100,'o gráfico vem no planejamento');assert.ok(r.indexOf('id="planGrafico"')<r.indexOf('<th scope="col">Semana</th>'),'antes da tabela das semanas');
 assert.match(fig,/<h3>Saldo projetado semana a semana<\/h3>/);
 assert.match(fig,/<line class="g-referencia"/,'linha da reserva');assert.match(fig,/class="g-rot g-rot-ref"[^>]*>Reserva mínima: R\$\s3\.000,00</);
 assert.match(fig,/g-chave g-chave-linha g-cor-atencao/,'reserva na legenda');assert.match(fig,/aria-label="Saldo projetado: de R\$\s10\.000,00 em 04\/10 para [^"]*Reserva mínima: R\$\s3\.000,00; \d+ semanas? abaixo dela\./);
 assert.match(fig,/g-cor-resultado/,'saldo que passa de positivo a negativo: cor neutra');
 assert.match(fig,/<th scope="col">Fim da semana<\/th><th scope="col" class="num">Saldo projetado<\/th>/,'"Ver os valores" como nos outros gráficos');
 assert.match(fig,/<th scope="row">20\/12 \*<\/th><td class="num">Parcial, fora do gráfico<\/td><\/tr><tr><th scope="row">27\/12 \*<\/th><td class="num">Parcial, fora do gráfico<\/td>/,'semana além da carga do Painel não vira ponto');
 assert.equal((fig.match(/<rect class="g-alvo"/g)||[]).length,13);assert.equal((fig.match(/g-sem-dado"/g)||[]).length,2);
 // sem reserva: só o zero de referência; tudo positivo: azul pelo sinal
 c.run("plano.reserva=0;plano.movimentos=[];plano.carteira=null;mostrarPlano()");const s=c.elementos.planResultado.innerHTML;
 assert.doesNotMatch(s,/g-referencia|g-rot-ref/);assert.match(s,/Sem reserva mínima informada: a referência é o zero\./);assert.match(s,/g-linha g-cor-entrada/);
 // sem saldo inicial, nada de gráfico
 c.run("plano.saldo='';mostrarPlano()");assert.doesNotMatch(c.elementos.planResultado.innerHTML,/planGrafico/);
});

test('gLinhaArea: a referência entra na escala e não desenha nada sem valor',()=>{
 const c=ctx();
 const h=c.run("gLinhaArea([{rotulo:'01/10',valor:100},{rotulo:'08/10',valor:200}],{referencia:{valor:500,rotulo:'Reserva mínima'},eixo:'Fim da semana'})");
 const y=Number(h.match(/<line class="g-referencia" x1="0" x2="1000" y1="([\d.]+)"/)[1]);assert.ok(y>=0&&y<=200,'acima dos pontos, mas dentro do gráfico');
 assert.match(h,/nenhum ponto abaixo dela|2 semanas abaixo dela/);
 assert.doesNotMatch(c.run("gLinhaArea([{rotulo:'01/10',valor:100}],{referencia:{valor:null}})"),/g-referencia/);
});

test('N24: "Ver em" do Glossário leva à seção pela rota secao=<chave>; verbete sem seção vai ao topo',()=>{
 const c=ctx();
 const termos=c.json('GlossarioFinanceiro.termos.map(t=>({nome:t.nome,tela:t.tela,secao:t.secao}))');
 const comSecao=termos.filter(t=>t.secao);assert.ok(comSecao.length>=30);
 // toda chave tem dono: um id="secao-<chave>" nas telas (cmp-* sai do cmpCard)
 const fonte=['app.js','gestao.js','dfc.js','indicadores.js','demonstrativos.js','parametros.js'].map(ler).join('\n');
 for(const t of comSecao){assert.ok(t.tela,t.nome+' sem tela');const k=t.secao;
  if(k.startsWith('cmp-'))assert.match(ler('comparativos.js'),new RegExp(`cmpCard\\('${k.slice(4)}'`),k);
  else assert.ok(fonte.includes(`secao-${k}`)||new RegExp(`CARTAO_SECAO=\\{[^}]*'${k}'`).test(fonte),`${t.nome}: falta o id secao-${k}`);}
 for(const n of ['Margem de contribuição','PDD (provisão para devedores duvidosos)','FCO, FCI e FCF','Necessidade de capital de giro','Liquidez','ROE (retorno sobre o patrimônio)','Aging (idade da carteira)'])assert.ok(comSecao.some(t=>t.nome===n),n);
 assert.equal(termos.find(t=>t.nome==='Capital de giro').secao,'','sem seção específica: topo');
 assert.match(c.run("conteudoTermo(GlossarioFinanceiro.termos.find(t=>t.nome==='Margem de contribuição'))"),/data-glossario-go="precos" data-glossario-ir="precos-mc">Ver em Preço e equilíbrio →/);
 assert.doesNotMatch(c.run("conteudoTermo(GlossarioFinanceiro.termos.find(t=>t.nome==='Capital de giro'))"),/data-glossario-ir/);
 // clique: tela, seção pendente e, nos Indicadores, a área que mostra a seção
 c.run("irDoGlossario('indicadores','ind-retorno')");assert.deepEqual(c.json('[state.view,state.secaoAlvo,state.indicadoresRota]'),['indicadores',{tela:'indicadores',chave:'ind-retorno'},{area:'Rentabilidade',fonte:'rentabilidade'}]);
 c.run("state.secaoAlvo=null;irDoGlossario('giro','')");assert.deepEqual(c.json('[state.view,state.secaoAlvo]'),['giro',null]);
 // rota: o link leva a seção; a gravação a mantém até a tela chegar nela
 const r=ctx({hash:'#tela=giro&mes=Ago/2026&secao=giro-ncg'});r.run('restaurarRota()');
 assert.deepEqual(r.json('[state.view,state.secaoAlvo]'),['giro',{tela:'giro',chave:'giro-ncg'}]);
 r.run('rotaAtual="";gravarRota()');assert.match(r.location.hash,/^#tela=giro&.*&secao=giro-ncg$/);
 for(const h of ['#tela=glossario&secao=painel','#tela=inexistente&secao=giro-ncg','#tela=giro&secao=a%22b'])assert.equal(ctx({hash:h}).run('restaurarRota();state.secaoAlvo'),null,h);
 assert.equal(ctx({hash:'#tela=glossario&secao=painel'}).run('restaurarRota();state.glossarioSecao'),'painel','o Glossário continua com a própria seção');
 // render: abre o cartão, rola e põe o foco no título; a seção sai da rota
 const foco=[],titulo={tagName:'SUMMARY',focus:()=>foco.push('summary'),hasAttribute:()=>false},alvo={tagName:'DETAILS',open:false,querySelector:()=>titulo,scrollIntoView:o=>foco.push('rolou:'+o.block)};
 r.elementos['secao-giro-ncg']=alvo;r.run('irSecaoPendente()');
 assert.deepEqual(foco,['rolou:start','summary']);assert.equal(alvo.open,true);assert.equal(r.run('state.secaoAlvo'),null);
 r.run('gravarRota()');assert.doesNotMatch(r.location.hash,/secao=/);
 // título que não recebe foco sozinho ganha tabindex=-1; trocar de tela cancela a seção pendente
 const atr={},h2={tagName:'H2',hasAttribute:k=>k in atr,setAttribute:(k,v)=>{atr[k]=v;},focus(){foco.push('h2');}};
 r.elementos['secao-precos-mc']={tagName:'DIV',querySelector:()=>h2,scrollIntoView(){}};r.run("state.view='precos';state.secaoAlvo={tela:'precos',chave:'precos-mc'};irSecaoPendente()");
 assert.equal(atr.tabindex,'-1');assert.equal(foco.at(-1),'h2');
 r.run("state.secaoAlvo={tela:'giro',chave:'giro-ncg'};state.view='dfc';irSecaoPendente()");assert.equal(r.run('state.secaoAlvo'),null);
});

// ── Ano em todas as telas (PLA-3): o relatório do ano no PDF ──
// O contrato vem de app.js (e o registro do ano de F.somarMeses); sem a frente integrada, a regra mínima
// do PLANO-ANO §2.2 e §2.3 só para este teste.
const CONTRATO_ANO=`
if(typeof telaNoAno!=='function')globalThis.telaNoAno=()=>anoAtivo()&&!anoCompetencia();
if(typeof anoDaTela!=='function')globalThis.anoDaTela=()=>Number(String(state.periodo).split('/')[1])||null;
if(typeof anosComparaveis!=='function')globalThis.anosComparaveis=(ano=anoDaTela())=>[...new Set(state.records.map(r=>Number(String(r.label).split('/')[1])).filter(Boolean))].filter(y=>y!==ano).sort((a,b)=>b-a);
if(typeof anoPadraoComparado!=='function')globalThis.anoPadraoComparado=(ano=anoDaTela())=>{const l=anosComparaveis(ano);return l.includes(ano-1)?ano-1:l.find(y=>y<ano)??null;};
if(typeof anoComparado!=='function')globalThis.anoComparado=()=>{const v=String(state.anoComparar??'');if(v==='nenhum')return null;if(/^\\d{4}$/.test(v)&&anosComparaveis().includes(Number(v)))return Number(v);return anoPadraoComparado();};
if(typeof TEXTO_SEM_ANO_COMPARADO==='undefined')globalThis.TEXTO_SEM_ANO_COMPARADO='Sem comparação: escolha um ano em “Comparar com”, no topo.';
if(typeof textoSemMesesComparaveis!=='function')globalThis.textoSemMesesComparaveis=(a,b)=>'Sem meses completos, da mesma base e com plano de contas em '+a+' e '+b+' para comparar.';
if(typeof rotuloMesesAno!=='function')globalThis.rotuloMesesAno=idx=>{if(!idx.length)return '';if(idx.length===12)return 'ano inteiro';const fx=[];for(const i of idx){const u=fx.at(-1);if(u&&i===u[1]+1)u[1]=i;else fx.push([i,i]);}const t=fx.map(([a,b])=>a===b?PT_MON[a]:PT_MON[a]+' a '+PT_MON[b]);return t.length>1?t.slice(0,-1).join(', ')+' e '+t.at(-1):t[0];};
if(typeof rotuloAno!=='function')globalThis.rotuloAno=(ano=anoDaTela())=>{const f=fimDoAno(ano),i=PT_MON.indexOf(f.split('/')[0]),r=state.records.find(x=>x.label===f);return ano+' · '+(i>0?'Jan a '+PT_MON[i]:'Jan')+(r&&F.qualidade(r).parcial?'*':'');};
if(typeof mesesComparaveisAno!=='function')globalThis.mesesComparaveisAno=(a,b)=>{const reg=l=>state.records.find(r=>r.label===l),ok=r=>r&&F.periodo(r.label).ate<dfcHoje()&&!F.qualidade(r).parcial;return PT_MON.map((m,i)=>i).filter(i=>{const x=reg(PT_MON[i]+'/'+a),y=reg(PT_MON[i]+'/'+b);return ok(x)&&ok(y)&&F.comparavelComRessalva(x,y).pode;});};
if(typeof registroDoAno!=='function')globalThis.registroDoAno=(ano,indices=null)=>{const f=fimDoAno(ano),idx=indices||[...Array(PT_MON.indexOf(f.split('/')[0])+1).keys()],regs=idx.map(i=>state.records.find(r=>r.label===PT_MON[i]+'/'+ano));if(regs.some(r=>!r))return {disponivel:false,motivo:'Mês sem dados coletados.'};const m=new Map();for(const r of regs)for(const c of r.cells){const e=m.get(c.code)||{code:c.code,name:c.name,value:0};e.value=(Math.round(e.value*100)+Math.round(c.value*100))/100;m.set(c.code,e);}return {disponivel:true,meses:regs.map(r=>r.label),reg:{id:'ano_'+ano,label:String(ano),rotulo:indices?ano+' · '+rotuloMesesAno(indices):rotuloAno(ano),company:regs[0].company,basis:regs[0].basis,origem:regs[0].origem,qualidade:{...regs.at(-1).qualidade},cells:[...m.values()],pendencias:regs.flatMap(r=>(r.pendencias||[]).map(p=>({...p,mes:r.label}))),eventos:[]}};};
if(typeof comparacaoDoAno!=='function')globalThis.comparacaoDoAno=(ano=anoDaTela(),anoComp=anoComparado())=>{if(anoComp==null)return {ano,anoComp,indices:[],motivo:TEXTO_SEM_ANO_COMPARADO};const indices=mesesComparaveisAno(ano,anoComp);if(!indices.length)return {ano,anoComp,indices,motivo:textoSemMesesComparaveis(ano,anoComp)};return {ano,anoComp,indices,meses:rotuloMesesAno(indices),atual:registroDoAno(ano,indices).reg,anterior:registroDoAno(anoComp,indices).reg,ressalva:false,motivo:''};};
`;
function ctxAno(comp){
 const c=ctx({periodo:'Set/2026'});const regs=[];
 for(const [ano,ate,e,s] of [[2024,12,800,600],[2025,12,900,700],[2026,9,1000,1100]])for(let i=0;i<ate;i++){const m=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][i],fim=new Date(Date.UTC(ano,i+1,0)).toISOString().slice(0,10);
  regs.push(reg(m+'/'+ano,ano===2026&&i===8?'2026-09-20':fim,{'1':e,'1.1':e,'2':s,'2.5':s-100,'2.5.3':s-100,'2.6':100}));}
 regs.find(r=>r.label==='Mar/2026').pendencias=[{tipo:'Sem conta',conta:'2.99',texto:'Pagamento sem conta',valor:-15}];
 c.__a=regs;c.run(`state.records=__a;dfcHoje=()=>'2026-09-22';state.anoTodo=true;state.anoComparar=${JSON.stringify(comp)}`);c.run(CONTRATO_ANO);return c;
}
test('PDF do Ano: subtítulo do ano, retrato e DRE do ano somado, comparação com o ano escolhido nos mesmos meses e arquivo com o ano',async()=>{
 const c=ctxAno('');const r=c.json("relatorioCFO({tipo:'executivo',periodo:'Set/2026',ano:true})");
 assert.equal(r.subtitulo,'2026 · Jan a Set* · Impresilk + Universo');assert.equal(r.periodo,'2026 · Jan a Set*');
 const retrato=r.blocos.find(b=>b.titulo==='Retrato do período');assert.deepEqual(retrato.linhas.map(l=>l[1].replace(/\s/g,' ')),['R$ 9.000,00','R$ 9.900,00','−R$ 900,00'],'9 meses de 2026 somados');
 const cmp=r.blocos.find(b=>/^Comparação com/.test(b.titulo));assert.equal(cmp.titulo,'Comparação com 2025 nos mesmos meses (Jan a Ago)');
 assert.deepEqual(cmp.colunas,['Conta','2025 · Jan a Ago','2026 · Jan a Ago','Diferença']);
 const l25=cmp.linhas.find(l=>/2\.5|Conta 2\.5$/.test(l[0]));assert.ok(l25,'a conta que mudou');assert.equal(l25[1].replace(/\s/g,' '),'R$ 4.800,00');assert.equal(l25[2].replace(/\s/g,' '),'R$ 8.000,00');
 assert.ok(r.blocos.some(b=>b.titulo==='DRE Simples, linha por linha'&&b.colunas[1]==='2026 · Jan a Set*'));
 const pend=r.blocos.find(b=>b.titulo==='Conferências pendentes');assert.deepEqual(pend.colunas,['Mês','Ocorrência','Valor']);assert.equal(pend.linhas[0][0],'Mar/2026');
 // peso de "Onde investigar" com vírgula decimal, como na tela (v136, N10); vale também para o relatório do mês
 for(const rel of [r,c.json("relatorioCFO({tipo:'executivo',periodo:'Set/2026'})")]){const inv=rel.blocos.find(b=>b.titulo==='Onde investigar');assert.ok(inv,'bloco Onde investigar');const pesos=inv.linhas.map(l=>l[2]).filter(x=>x!=='—');assert.ok(pesos.length,'há peso');for(const x of pesos)assert.match(x,/^\d+,\d%$/);}
 // ano escolhido: 2024; Sem comparação: a nota, sem a tabela
 c.run("state.anoComparar='2024'");assert.ok(c.json("relatorioCFO({tipo:'executivo',periodo:'Set/2026',ano:true})").blocos.some(b=>b.titulo==='Comparação com 2024 nos mesmos meses (Jan a Ago)'));
 c.run("state.anoComparar='nenhum'");const sem=c.json("relatorioCFO({tipo:'custos',periodo:'Set/2026',ano:true})");
 assert.ok(!sem.blocos.some(b=>/^Comparação com/.test(b.titulo)));assert.ok(sem.notas.includes('Sem comparação: escolha um ano em “Comparar com”, no topo.'));assert.ok(sem.blocos.some(b=>/^Despesas · 1º trimestre/.test(b.titulo)),'custos mantém as despesas por mês');
 // nada de "−" no jsPDF, e o arquivo leva o ano
 c.run("state.anoComparar=''");const {Doc,textos}=jsPDFFalso();const salvos=[];Doc.prototype.save=n=>salvos.push(n);c.__Doc=Doc;c.run('PDFCFO.carregar=async()=>__Doc');
 await c.run("exportarCFO({tipo:'executivo',periodo:'Set/2026',ano:true})");assert.deepEqual(salvos,['impresilk-executivo-2026.pdf']);
 assert.deepEqual(textos.filter(t=>/[−–—]/.test(t)),[]);assert.ok(textos.includes('2026 · Jan a Set* · Impresilk + Universo'));
 // fora do Ano (ano:false): o relatório do mês, como na v135
 const m=c.json("relatorioCFO({tipo:'executivo',periodo:'Set/2026'})");assert.equal(m.subtitulo,'Set/2026 · Impresilk + Universo');assert.ok(!m.blocos.some(b=>/nos mesmos meses/.test(b.titulo)));
});
