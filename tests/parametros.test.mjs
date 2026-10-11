// Parâmetros (Fase 2): cadastro por empresa e mês, alíquota padrão sempre marcada,
// impostos e taxas por local lidos das contas 2.4 e gravação que só troca o pedaço editado.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
const base=[cel('1','Entradas',10000),cel('2','Saídas',8000)];
const REGISTROS=[
 {id:'Ago_2026',label:'Ago/2026',origem:'erp',qualidade:{ate:'2026-08-31'},cells:[...base,cel('2.4','Despesas Impostos',3000),cel('2.4.1','DAS',2000),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','Impresilk',1500),cel('2.4.1.3','Universo',200),cel('2.4.2','ICMS',400),cel('2.4.5','IPTU',350),cel('2.4.5.1','Feliciano Martins 127',250),cel('2.4.5.5','Inocêncio Teixeira 201',100),cel('2.4.6','Taxa de Fiscalização e Funcionamento',250),cel('2.4.6.1','Impresilk',250)]},
 {id:'Set_2026',label:'Set/2026',origem:'erp',qualidade:{ate:'2026-09-30'},cells:[...base,cel('2.4','Despesas Impostos',1800),cel('2.4.1','DAS',1700),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','Impresilk',1200),cel('2.4.1.3','Universo',200),cel('2.4.8','ISSQN',50)]},
 {id:'Out_2026',label:'Out/2026',origem:'erp',qualidade:{ate:'2026-10-08'},cells:[...base,cel('2.4','Despesas Impostos',1020),cel('2.4.1','DAS',900),cel('2.4.1.2','Impresilk',900),cel('2.4.2','ICMS',120)]}
];
// Ordem de chaves do jsonb do Postgres: por tamanho, depois por bytes.
const jsonb=v=>Array.isArray(v)?v.map(jsonb):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>a.length-b.length||(a<b?-1:a>b?1:0)).map(k=>[k,jsonb(v[k])])):v;
class FormDataFalso{constructor(f){this.f=f;}*[Symbol.iterator](){yield* Object.entries(this.f.__campos).filter(([k])=>!this.f.__bloqueados?.includes(k));}}
function context({periodo='Set/2026',cfg={},admin=true,registros=REGISTROS}={}){
 const c={structuredClone,FormData:FormDataFalso,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.set=(k,v)=>{c.__v=v;c.run(`${k}=__v`);};c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));
 c.set('state.records',structuredClone(registros));c.set('state.cfg',structuredClone(cfg));c.set('state.periodo',periodo);c.set('state.permissoes',{leitura:true,edicao:admin,admin});
 c.renders=0;c.toasts=[];c.__render=()=>{c.renders++;};c.__toast=(t,k)=>c.toasts.push([t,k||'']);c.run('render=__render;toast=__toast');
 return c;
}
const tela=c=>c.run('renderParametros()');
// Nuvem simulada: devolve o cfg na ordem do jsonb, como o Postgres faz.
function nuvem(c,{cfg,atualizadoEm='t0',falhaSet=null}={}){
 c.nuvem={cfg:structuredClone(cfg),em:atualizadoEm};c.chamadas=[];
 c.__api=async(acao,payload)=>{c.chamadas.push([acao,structuredClone(payload)]);
  if(acao==='getCfg')return {ok:true,cfg:jsonb(structuredClone(c.nuvem.cfg)),atualizadoEm:c.nuvem.em};
  if(acao==='setCfg'){if(falhaSet)return falhaSet;if(payload.baseAtualizadoEm!==c.nuvem.em)return {conflito:true};c.nuvem={cfg:structuredClone(payload.cfg),em:c.nuvem.em+'+'};return {ok:true,atualizadoEm:c.nuvem.em};}
  return {ok:false};};
 c.run('api=__api');
}
// Formulário falso com o mesmo contrato do navegador (dataset, FormData, botões, .param-erro).
function formFalso(c,{tipo,empresa='',mes='',conta='',original=null,campos={},bloqueados=[]}){
 const erro={textContent:'',classList:{add(){},remove(){}}},botao={disabled:false,focus(){}};
 const f={dataset:{paramForm:tipo,...(empresa?{empresa}:{}),...(mes?{mes}:{}),...(conta?{conta}:{}),original:JSON.stringify(original)},__campos:campos,__bloqueados:bloqueados,isConnected:true,
  elements:Object.entries(campos).map(([name,value])=>({name,value,disabled:bloqueados.includes(name)})),classList:{add(){}},
  querySelector:s=>s==='.param-erro'?erro:s.startsWith('button')?botao:null,querySelectorAll:()=>[botao],closest:s=>s==='form[data-param-form]'?f:null};
 f.erro=erro;return f;
}

test('meses: chave AAAA-MM, virada de ano e rótulo inválido',()=>{
 const c=context();
 assert.equal(c.run("paramMesChave('Set/2026')"),'2026-09');assert.equal(c.run("paramMesLabel('2026-09')"),'Set/2026');
 assert.equal(c.run("paramMesDesloca('Dez/2026',1)"),'Jan/2027');assert.equal(c.run("paramMesDesloca('Jan/2026',-1)"),'Dez/2025');
 assert.equal(c.run("paramMesChave('Setembro')"),null);assert.equal(c.run("paramMesDesloca('',1)"),null);
});
test('alíquota sem extrato usa o padrão provisório, sempre marcado e fora do gráfico',()=>{
 const c=context();const h=tela(c);
 assert.equal((h.match(/Padrão provisório · trocar pelo PGDAS-D/g)||[]).length,4,'dois cards e dois resumos marcados');
 assert.match(h,/Alíquota efetiva · Impresilk<\/span><strong class="">6,00%<\/strong>/);
 assert.match(h,/O padrão provisório \(6,00%\) não entra no gráfico/);
 assert.equal((h.match(/class="g-aviso" role="img" aria-label="Não apurado: nenhum ponto com valor\."/g)||[]).length,2,'sem alíquota informada, o gráfico não desenha o padrão');
 const c2=context({cfg:{parametros:{simples:{'2026-09':{impresilk:{anexo:'III',aliquota:7.4583}}}}}});const h2=tela(c2);
 assert.match(h2,/Alíquota efetiva · Impresilk<\/span><strong class="">7,4583%<\/strong><small>Competência Set\/2026 · Anexo III<\/small><\/div>/,'alíquota com 4 casas, sem arredondar');
 assert.equal((h2.match(/Padrão provisório/g)||[]).length,2,'só a Universo continua no padrão');
 assert.deepEqual(c2.json("paramAliquota('universo','Set/2026')"),{valor:6,origem:'padrao'});
});
test('cards: DAS pago no mês sem o parcelamento e impostos fora do DAS pela conta 2.4',()=>{
 const h=tela(context());
 assert.match(h,/Simples pago em Set\/2026<\/span><strong class="tom-sai">R\$\s1\.400,00<\/strong><small>DAS e DARF da competência Ago\/2026\. Parcelamento à parte: R\$\s300,00\.<\/small>/);
 assert.match(h,/Impostos e taxas fora do Simples · Set\/2026<\/span><strong class="tom-sai">R\$\s100,00<\/strong>/);
 const vazio=tela(context({periodo:'Jul/2026'}));
 assert.match(vazio,/Simples pago em Jul\/2026<\/span><strong class="">Não apurado<\/strong>/);
 assert.doesNotMatch(vazio,/R\$\s0,00/,'mês sem dados nunca vira zero');
});
test('textos da tela seguem os fatos do negócio',()=>{
 const h=tela(context());
 assert.match(h,/DAS \(2\.4\.1\.2 e 2\.4\.1\.3\) e DARF \(2\.4\.3\.1 e 2\.4\.3\.2\), e é pago no mês seguinte; o parcelamento \(2\.4\.1\.1\) é dívida e fica de fora/);
 assert.match(h,/A folha do Fator R não inclui retiradas: não há pró-labore/);assert.match(h,/O ICMS e o DIFAL das compras em outros estados são pagos na conta 2\.4\.2: informe no local a UF de origem das compras\. O DAS e o DARF do PGDAS ficam no quadro do Simples\./);
});
test('guia da competência é a do mês seguinte; mês em andamento é marcado com a data do corte',()=>{
 const ago=tela(context({periodo:'Ago/2026'}));assert.match(ago,/<dd><span class="tom-sai">R\$\s1\.200,00<\/span> pagos em Set\/2026\.<\/dd>/,'só o valor em vermelho');
 const set=tela(context());
 assert.match(set,/R\$\s900,00<\/span> pagos em Out\/2026, até 08\/10 \(mês em andamento\)\./);
 assert.match(set,/Out\/2026 em andamento: guia ainda não paga até 08\/10\./,'Universo ainda sem guia no mês corrente');
 assert.match(tela(context({periodo:'Out/2026'})),/Nov\/2026 ainda sem dados: a guia desta competência vence no mês seguinte\./);
});
test('DAS que não fecha com a conta 2.4.1 aparece como "a conferir", nunca some',()=>{
 const reg=structuredClone(REGISTROS);reg[1].cells=[...base,cel('2.4','Despesas Impostos',1800),cel('2.4.1','DAS',1700),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.3','Universo',200),cel('2.4.1.51','DAS Impresilk',1200),cel('2.4.8','ISSQN',100)];
 const h=tela(context({registros:reg}));
 assert.match(h,/Simples pago em Set\/2026<\/span><strong class="tom-sai">R\$\s200,00<\/strong><small>[^<]*R\$\s1\.200,00 lançados no DAS e no DARF fora das subcontas da Impresilk e da Universo\.<\/small><span class="origem-dado origem-padrao">A conferir no Plano de contas<\/span>/);
 const ago=tela(context({periodo:'Ago/2026',registros:reg}));
 assert.match(ago,/Não apurado: R\$\s1\.200,00 do DAS e do DARF de Set\/2026 estão fora das subcontas conhecidas/,'a Impresilk não lê "nenhuma guia" quando há DAS sem subconta');
 assert.match(h,/Sem subconta/,'o gráfico mostra o resto como série própria');
 const soPai=structuredClone(REGISTROS);soPai[1].cells=[...base,cel('2.4','Despesas Impostos',1400),cel('2.4.1','DAS',1400)];
 assert.match(tela(context({registros:soPai})),/Simples pago em Set\/2026<\/span><strong class="">A conferir<\/strong>/,'mês só com o total do DAS não vira "sem guia"');
});
test('gráfico do DAS: só as guias (sem o parcelamento), em tons de saída, mês parcial e sem dados hachurados',()=>{
 const h=tela(context());const das=h.slice(h.indexOf('param-das'));
 assert.match(h,/<section class="chart-card param-grafico param-das">/);
 assert.match(das,/data-dica="Set\nImpresilk: R\$\s1\.200,00\nUniverso: R\$\s200,00"/);assert.doesNotMatch(das.slice(0,das.indexOf('</section>')),/Parcelamento:/);
 assert.match(das,/data-dica="Out\nImpresilk: Não apurado/,'mês em andamento não entra como valor');assert.match(das,/data-dica="Jan\nImpresilk: Não apurado/);
 assert.match(ler('compacto.css'),/\.param-das \.g-cor-serie-1\{fill:var\(--g-saida\)/);
});
test('impostos por local: folhas da conta 2.4 sem o DAS, com nome do pai, sugestões e diferença explícita',()=>{
 const c=context({periodo:'Ago/2026'});
 assert.deepEqual(c.json('paramContasTributos().map(t=>[t.code,t.rotulo,t.sugestao.local,t.sugestao.empresa])'),[['2.4.2','ICMS','',''],['2.4.5.1','IPTU · Feliciano Martins 127','Feliciano Martins 127',''],['2.4.5.5','IPTU · Inocêncio Teixeira 201','Inocêncio Teixeira 201',''],['2.4.6.1','Taxa de Fiscalização e Funcionamento · Impresilk','','impresilk'],['2.4.8','ISSQN','','']]);
 const h=tela(c);assert.doesNotMatch(h.slice(h.indexOf('tabela-tributos')),/2\.4\.1\.\d/,'DAS e parcelamento ficam no bloco do Simples');
 assert.match(h,/<b>2 locais:<\/b> Feliciano Martins 127 · Inocêncio Teixeira 201/);
 assert.match(h,/Feliciano Martins 127 <small class="param-sugestao">pelo nome da conta<\/small>/);
 const set=tela(context());
 assert.match(set,/<th scope="row">Sem subconta específica<\/th><td colspan="5">[^<]*<\/td><td class="num tom-sai">R\$\s50,00<\/td>/,'2.4 sem DAS = 100, itens = 50: a diferença aparece, não some');
 assert.match(set,/<th scope="row">Total fora do Simples<\/th><td colspan="5"><\/td><td class="num tom-sai">R\$\s100,00<\/td>/);
 assert.match(ler('compacto.css'),/\.tabela-tributos td\.num\.tom-sai\{color:var\(--red\)\}/,'pago em vermelho também na tabela');
});
test('mês em andamento: card, gráfico, total e situação dizem até quando foi coletado',()=>{
 const h=tela(context({periodo:'Out/2026'}));
 assert.match(h,/Impostos e taxas fora do Simples · Out\/2026<\/span><strong class="tom-sai">R\$\s120,00<\/strong><small>[^<]*coletados até 08\/10 \(mês em andamento\)\./);
 assert.match(h,/Pagos em Out\/2026 até 08\/10 \(mês em andamento\), fora do Simples/);
 assert.match(h,/Total fora do Simples até 08\/10 \(mês em andamento\)<\/th>/);
 assert.match(h,/ICMS <small class="param-conta">2\.4\.2 · Mubisys 2\.3\.2<\/small>[\s\S]*?Pago até agora · sem cadastro/);
 assert.match(h,/ISSQN <small class="param-conta">2\.4\.8 · Mubisys 2\.3\.8<\/small>[\s\S]*?Mês em andamento · sem cadastro/);
});
test('situação compara o pago com o cadastro; só "Mensal" acusa falta; estorno é dito',()=>{
 const cfg={parametros:{tributos:{'2.4.5.1':{recorrencia:'Mensal',previsto:300},'2.4.2':{recorrencia:'Mensal'},'2.4.8':{recorrencia:'Eventual'},'2.4.5.5':{recorrencia:'Anual parcelado'}}}};
 const sit=(periodo,code,registros)=>{const c=context({periodo,cfg,registros});return c.json(`(()=>{const t=paramContasTributos().find(x=>x.code===${JSON.stringify(code)});return paramSituacao(t,paramPago(${JSON.stringify(periodo)},t.code))})()`);};
 assert.deepEqual(sit('Ago/2026','2.4.5.1'),{texto:'Pago diferente do previsto',classe:'atencao'},'250 contra 300 previstos');
 assert.equal(sit('Ago/2026','2.4.2').texto,'Pago');
 assert.deepEqual(sit('Set/2026','2.4.2'),{texto:'Sem pagamento no mês',classe:'atencao'},'mensal, mês fechado, nada pago');
 assert.deepEqual(sit('Set/2026','2.4.5.5'),{texto:'Sem pagamento no mês',classe:'neutra'},'carnê anual não acende alerta todo mês');
 assert.equal(sit('Out/2026','2.4.2').texto,'Pago até agora');assert.equal(sit('Jul/2026','2.4.2').texto,'Mês sem dados');
 assert.equal(sit('Ago/2026','2.4.6.1').texto,'Pago · sem cadastro');
 const est=structuredClone(REGISTROS);est[1].cells.push(cel('2.4.7','IOF',-10));est[1].cells.find(x=>x.code==='2.4').value=1790;
 assert.equal(sit('Set/2026','2.4.7',est).texto,'Estorno no mês');
 const h=tela(context({registros:est}));assert.match(h,/<td class="num tom-entra">-R\$\s10,00<\/td>/,'estorno aparece com valor, em azul');
 assert.match(h,/<th scope="row">Sem subconta específica<\/th><td colspan="5">[^<]*<\/td><td class="num tom-sai">R\$\s50,00<\/td>/,'o estorno entra na soma: a diferença continua a mesma de antes (50), sem inventar outra');
});
test('cadastro numa conta que ganhou subcontas não é somado duas vezes',()=>{
 const reg=structuredClone(REGISTROS);reg[1].cells=[...base,cel('2.4','Despesas Impostos',2200),cel('2.4.1','DAS',1700),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','Impresilk',1200),cel('2.4.1.3','Universo',200),cel('2.4.2','ICMS',500),cel('2.4.2.1','ICMS Impresilk',300),cel('2.4.2.2','ICMS Universo',200)];
 const c=context({registros:reg,cfg:{parametros:{tributos:{'2.4.2':{local:'MG (DIFAL)'}}}}});
 const codes=c.json('paramContasTributos().map(t=>t.code)');assert.ok(!codes.includes('2.4.2')&&codes.includes('2.4.2.1')&&codes.includes('2.4.2.2'),'a conta mãe sai da lista quando ganha subcontas');
 const h=tela(c);assert.doesNotMatch(h,/Sem subconta específica/);assert.match(h,/Cadastro sem uso:[\s\S]*ICMS <small class="param-conta">2\.4\.2 · Mubisys 2\.3\.2<\/small> → 2\.4\.2\.1, 2\.4\.2\.2/);
});
test('número no formato brasileiro: milhar com ponto, decimal com vírgula; o resto é recusado, nunca vira vazio',()=>{
 const c=context();const n=s=>c.run(`paramNumeroBR(${JSON.stringify(s)})`);
 assert.equal(n('1.200.000,00'),1200000);assert.equal(n('1200000,50'),1200000.5);assert.equal(n('7,45'),7.45);assert.equal(n('7.45'),7.45);assert.equal(n('R$ 1.500'),1500);assert.equal(n('-2.500,50'),-2500.5);assert.equal(n('11,32%'),11.32);assert.equal(n(''),null);
 for(const ruim of ['1,200.50','1e5','abc','1.2.3','12,5,0'])assert.ok(Number.isNaN(n(ruim)),ruim+' não é número');
 assert.throws(()=>c.run("paramValidarSimples({rbt12:'1,200.50'})"),/RBT12: número não reconhecido/);
 assert.throws(()=>c.run("paramValidarSimples({rbt12:'10,005'})"),/no máximo 2 casas/);
 assert.equal(c.run("paramValidarSimples({aliquota:'7,4583'})").aliquota,7.4583,'alíquota guarda até 4 casas');
 assert.equal(c.run("paramParaCampo('rbt12',1200000)"),'1.200.000,00');assert.equal(c.run("paramNumeroBR(paramParaCampo('rbt12',1234567.8))"),1234567.8,'o que volta ao campo é lido de novo igual');
 assert.match(c.run('renderParametros()'),/<input name="rbt12" type="text" inputmode="decimal" autocomplete="off"/,'campo de texto: o navegador não reinterpreta a vírgula');
});
test('DARF do PGDAS conta no Simples: card, guia por empresa e gráfico; sai de "fora do Simples" e da tabela por local',()=>{
 const reg=structuredClone(REGISTROS);reg[1].cells=[...base,cel('2.4','Despesas Impostos',2300),cel('2.4.1','DAS',1700),cel('2.4.1.1','Parcelamento Impresilk',300),cel('2.4.1.2','Impresilk',1200),cel('2.4.1.3','Universo',200),cel('2.4.3','DARF',500),cel('2.4.3.1','Impresilk',400),cel('2.4.3.2','Universo',100),cel('2.4.8','ISSQN',100)];
 const h=tela(context({registros:reg}));
 assert.match(h,/Simples pago em Set\/2026<\/span><strong class="tom-sai">R\$\s1\.900,00<\/strong>/,'DAS 1.400 + DARF 500');
 assert.match(h,/Impostos e taxas fora do Simples · Set\/2026<\/span><strong class="tom-sai">R\$\s100,00<\/strong>/,'só o ISSQN');
 assert.doesNotMatch(h.slice(h.indexOf('tabela-tributos')),/2\.4\.3/,'DARF não aparece como imposto fora do Simples');
 assert.match(h,/data-dica="Set\nImpresilk: R\$\s1\.600,00\nUniverso: R\$\s300,00"/,'gráfico do Simples com DAS + DARF por empresa');
 const ago=tela(context({periodo:'Ago/2026',registros:reg}));assert.match(ago,/R\$\s1\.600,00<\/span> pagos em Set\/2026\./);
 const resto=structuredClone(reg);resto[1].cells=resto[1].cells.map(x=>x.code==='2.4.3'?{...x,value:700}:x.code==='2.4'?{...x,value:2500}:x);
 assert.match(tela(context({periodo:'Ago/2026',registros:resto})),/R\$\s1\.600,00<\/span> pagos em Set\/2026; mais R\$\s200,00 no DAS e no DARF fora das subcontas, a conferir\./,'o da empresa não se passa pelo total');
});
test('cadastro antigo do DARF não some: aparece como sem uso, com Editar',()=>{
 const h=tela(context({periodo:'Ago/2026',cfg:{parametros:{tributos:{'2.4.3.1':{local:'BH'}}}}}));
 assert.match(h,/Cadastro sem uso:[\s\S]*<small class="param-conta">2\.4\.3\.1 · Mubisys 2\.3\.3\.1<\/small> → agora no quadro do Simples \(DAS e DARF\) <button type="button" class="link-cadastro" data-param-tributo="2\.4\.3\.1"/);
});
test('validação: anexo, faixas, inteiros, CNPJ, Fator R exato e avisos condicionais',()=>{
 const c=context();const v=s=>c.run(s);
 assert.throws(()=>v("paramValidarSimples({anexo:'VI'})"),/Anexo/);assert.throws(()=>v("paramValidarSimples({aliquota:'120'})"),/Alíquota efetiva/);assert.throws(()=>v("paramValidarSimples({rbt12:'-1'})"),/RBT12/);
 assert.equal(v("paramValidarSimples({anexo:'',rbt12:'',aliquota:'',folha12:''})"),null);
 assert.deepEqual(c.json("paramValidarSimples({anexo:'I',rbt12:'1.000.000,00',aliquota:'',folha12:'300000'})"),{anexo:'I',rbt12:1000000,aliquota:null,folha12:null},'folha só vale no III e no V; alíquota vazia não vira padrão');
 assert.equal(v("paramFatorR({anexo:'III',rbt12:1000000,folha12:300000})"),30);
 assert.match(v("paramAvisosSimples({anexo:'V',rbt12:1000000,folha12:279960}).join(' ')"),/Fator R 27,99%.*abaixo de 28% leva ao Anexo V/,'27,996% não vira 28%');
 assert.match(v("paramAvisosSimples({anexo:'V',rbt12:1000000,folha12:280000}).join(' ')"),/Fator R 28,00%.*28% ou mais leva ao Anexo III/);
 assert.match(v("paramAvisosSimples({rbt12:3700000}).join(' ')"),/sublimite do ICMS e do ISS\. Se a receita do ano passar desse valor[^.]*: confira com a contabilidade/);
 assert.match(v("paramAvisosSimples({rbt12:5000000}).join(' ')"),/teto do Simples\. O limite se mede pela receita do ano-calendário/);
 assert.throws(()=>v("paramValidarOperacao({prazoRecebimento:'10,5'})"),/inteiro/);
 assert.equal(v("paramCnpjValido('11.222.333/0001-81')"),true);assert.equal(v("paramCnpjValido('11.222.333/0001-82')"),false);assert.equal(v("paramCnpjValido('00000000000000')"),false);
 assert.throws(()=>v("paramValidarEmpresa({cnpj:'11.222.333/0001-82'})"),/CNPJ inválido/);
 assert.throws(()=>v("paramValidarTributo({empresa:'outra'})"),/Empresa/);assert.throws(()=>v("paramValidarTributo({vencimento:'32'})"),/vencimento/);
 const juntas=tela(context({cfg:{parametros:{simples:{'2026-09':{impresilk:{rbt12:3000000},universo:{rbt12:2000000}}}}}}));
 assert.match(juntas,/Impresilk e Universo somam R\$\s5\.000\.000,00 de RBT12\. Se as duas tiverem sócio em comum/);
});
test('gravar relê a nuvem, troca só o pedaço editado e guarda o histórico',async()=>{
 const naNuvem={gestao:{plano:{x:1}},permissoes:{admin:['a']},parametros:{versao:1,simples:{'2026-08':{impresilk:{anexo:'III'}}},historico:[]}};
 const c=context({cfg:structuredClone(naNuvem)});nuvem(c,{cfg:naNuvem});
 await c.run("salvarParametros(['simples','2026-09','universo'],{anexo:'I',rbt12:450000,aliquota:null,folha12:null},null)");
 const [acao,payload]=c.chamadas[1];assert.equal(acao,'setCfg');assert.equal(payload.baseAtualizadoEm,'t0');
 assert.deepEqual(payload.cfg.gestao,naNuvem.gestao,'planejamento intacto');assert.deepEqual(payload.cfg.permissoes,naNuvem.permissoes,'permissões intactas');
 assert.deepEqual(payload.cfg.parametros.simples['2026-08'],naNuvem.parametros.simples['2026-08'],'outro mês intacto');
 const novo=payload.cfg.parametros.simples['2026-09'].universo;assert.equal(novo.anexo,'I');assert.equal(novo.aliquota,null);assert.ok(novo.revisadoEm);
 assert.deepEqual(payload.cfg.parametros.historico.map(h=>h.caminho),[['simples','2026-09','universo']]);
 assert.equal(c.run('state.cfgVersion'),'t0+');assert.equal(c.run("state.cfg.parametros.simples['2026-09'].universo.rbt12"),450000);
});
test('segunda gravação na mesma sessão passa mesmo com o jsonb devolvendo as chaves em outra ordem',async()=>{
 const c=context();nuvem(c,{cfg:{}});
 const original=()=>c.run("JSON.stringify(paramLerCaminho(state.cfg.parametros||{},['simples','2026-09','impresilk']))");
 await c.run("salvarParametros(['simples','2026-09','impresilk'],{anexo:'III',rbt12:1000000,aliquota:7.5,folha12:300000},null)");
 c.__orig=JSON.parse(original());
 await c.run("salvarParametros(['simples','2026-09','impresilk'],{anexo:'III',rbt12:1000000,aliquota:7.6,folha12:300000},__orig)");
 assert.equal(c.nuvem.cfg.parametros.simples['2026-09'].impresilk.aliquota,7.6);
});
test('gravar recusa edição sobre versão antiga, acesso não administrativo, conflito e queda de rede',async()=>{
 const naNuvem={parametros:{operacao:{'2026-09':{estoque:500}}}};
 const c=context();nuvem(c,{cfg:naNuvem});
 await assert.rejects(c.run("salvarParametros(['operacao','2026-09'],{estoque:900},null)"),/mudou na nuvem/);
 assert.equal(c.chamadas.filter(x=>x[0]==='setCfg').length,0,'nada é gravado sobre a mudança de outra pessoa');
 const leitor=context({admin:false});nuvem(leitor,{cfg:{}});
 await assert.rejects(leitor.run("salvarParametros(['operacao','2026-09'],{estoque:1},null)"),/administrativo/);assert.equal(leitor.chamadas.length,0);
 const c3=context();nuvem(c3,{cfg:{},falhaSet:{conflito:true}});
 await assert.rejects(c3.run("salvarParametros(['operacao','2026-09'],{estoque:1},null)"),/mudaram durante a gravação/);
 assert.equal(c3.run('state.cfg.parametros'),undefined,'estado local não muda quando a gravação falha');
 const c4=context();c4.run("api=async()=>{const e=new Error('signal is aborted');e.name='AbortError';throw e;}");
 await assert.rejects(c4.run("salvarParametros(['operacao','2026-09'],{estoque:1},null)"),/não respondeu a tempo\. Recarregue a tela e confira/);
});
test('formulário de verdade: o envio delegado chega ao cadastro no caminho certo, com número brasileiro',async()=>{
 const c=context();nuvem(c,{cfg:{gestao:{a:1}}});
 const h={};c.__doc={addEventListener:(t,fn)=>{(h[t]=h[t]||[]).push(fn);},querySelector:()=>null};c.run('document=__doc;wireParametros()');
 const f=formFalso(c,{tipo:'simples',empresa:'universo',mes:'Set/2026',campos:{anexo:'III',rbt12:'1.200.000,00',aliquota:'7,45',folha12:'360.000,00'}});
 let impedido=false;h.submit[0]({target:{closest:s=>f.closest(s)},preventDefault:()=>{impedido=true;}});
 assert.ok(impedido,'o envio nativo é impedido (senão a página recarrega)');
 await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));
 assert.deepEqual({...c.nuvem.cfg.parametros.simples['2026-09'].universo,revisadoEm:'x'},{anexo:'III',rbt12:1200000,aliquota:7.45,folha12:360000,revisadoEm:'x'});
 assert.deepEqual(c.nuvem.cfg.gestao,{a:1});assert.equal(c.renders,1);assert.match(c.toasts[0][0],/Simples da Universo em Set\/2026 salvo/);
 const ruim=formFalso(c,{tipo:'operacao',mes:'Set/2026',campos:{estoque:'1,200.50'}});const antes=c.chamadas.length;
 await c.run('paramSalvarForm')(ruim);assert.match(ruim.erro.textContent,/Estoque: número não reconhecido/);assert.equal(c.chamadas.length,antes,'número ilegível não grava nada');
});
test('conflito mostra o que a outra pessoa mudou e o segundo "Salvar" mantém os seus valores',async()=>{
 const c=context();nuvem(c,{cfg:{parametros:{tributos:{'2.4.2':{local:'SP',previsto:900}}}}});
 const f=formFalso(c,{tipo:'tributo',conta:'2.4.2',original:{local:'MG',previsto:100},campos:{local:'MG',empresa:'',recorrencia:'Mensal',vencimento:'10',previsto:'100,00',observacao:''}});
 c.run('document={addEventListener(){},getElementById:()=>null,querySelector:()=>null}');
 const salvar=c.run('paramSalvarForm');await salvar(f);
 assert.match(f.erro.textContent,/Outra pessoa mudou este cadastro na nuvem: Local: MG → SP; Valor previsto: R\$\s100,00 → R\$\s900,00\. Confira; para manter os seus valores, salve de novo\./);
 assert.equal(c.chamadas.filter(x=>x[0]==='setCfg').length,0);
 await salvar(f);assert.equal(c.nuvem.cfg.parametros.tributos['2.4.2'].local,'MG','segunda vez é decisão consciente');
});
test('o que foi digitado e não salvo sobrevive ao redesenho, com o original de quando começou a edição',()=>{
 const c=context({cfg:{parametros:{simples:{'2026-09':{universo:{anexo:'I',rbt12:400000}}}}}});
 const f=formFalso(c,{tipo:'simples',empresa:'universo',mes:'Set/2026',original:{anexo:'I',rbt12:400000},campos:{anexo:'I',rbt12:'450.000,00',aliquota:'',folha12:''},bloqueados:['folha12']});
 c.run('paramRegistrarRascunho')(f);
 c.set('state.cfg',{parametros:{simples:{'2026-09':{universo:{anexo:'I',rbt12:999999}}}}});
 const h=tela(c),bloco=h.slice(h.indexOf('data-empresa="universo" data-mes="Set/2026"'));
 assert.match(bloco,/data-original="\{&quot;anexo&quot;:&quot;I&quot;,&quot;rbt12&quot;:400000\}"/,'o conflito continua sendo detectado contra o valor de quando começou');
 assert.match(bloco,/<input name="rbt12" type="text" inputmode="decimal" autocomplete="off" value="450\.000,00">/);
 assert.match(bloco,/<p class="param-pendente" role="status">Alterações não salvas neste quadro\./);
 assert.match(h.slice(h.indexOf('data-empresa="impresilk" data-mes')),/<p class="param-pendente" role="status" hidden>/,'o outro quadro não está pendente');
});
test('diálogo do imposto: com cadastro vale o gravado (mesmo vazio); a sugestão só aparece sem cadastro e diz de onde veio',()=>{
 const abrir=(cfg,code)=>{const c=context({periodo:'Ago/2026',cfg});c.run('dialog=(t,h)=>{__dlg={t,h}}');c.run(`paramAbrirTributo(${JSON.stringify(code)})`);return c.run('__dlg');};
 const novo=abrir({},'2.4.6.1');assert.equal(novo.t,'Taxa de Fiscalização e Funcionamento · Impresilk (2.4.6.1)');
 assert.match(novo.h,/A empresa veio do nome da conta: confira antes de salvar\./);assert.match(novo.h,/<option value="impresilk" selected>/);
 assert.doesNotMatch(abrir({},'2.4.2').h,/vieram? do nome da conta/,'sem sugestão, sem frase');
 const gravado=abrir({parametros:{tributos:{'2.4.6.1':{empresa:null,recorrencia:'Anual (parcela única)'}}}},'2.4.6.1');
 assert.doesNotMatch(gravado.h,/<option value="impresilk" selected>/,'"Não informada" gravada não volta a ser Impresilk');assert.doesNotMatch(gravado.h,/nome da conta/);
 assert.match(gravado.h,/data-original="\{&quot;empresa&quot;:null,&quot;recorrencia&quot;:&quot;Anual \(parcela única\)&quot;\}"/,'original guardado na abertura');
});
test('"Apagar cadastro" pelo formulário apaga de fato (não grava o que está nos campos)',async()=>{
 const c=context({cfg:{parametros:{tributos:{'2.4.2':{local:'MG'},'2.4.8':{local:'BH'}}}}});nuvem(c,{cfg:{parametros:{tributos:{'2.4.2':{local:'MG'},'2.4.8':{local:'BH'}}}}});
 c.run('document={addEventListener(){},getElementById:()=>null,querySelector:()=>null}');
 const f=formFalso(c,{tipo:'tributo',conta:'2.4.2',original:{local:'MG'},campos:{local:'MG',empresa:'',recorrencia:'',vencimento:'',previsto:'',observacao:''}});
 await c.run('paramSalvarForm')(f,true);
 assert.deepEqual(c.nuvem.cfg.parametros.tributos,{'2.4.8':{local:'BH'}});assert.match(c.toasts.at(-1)[0],/Cadastro do imposto apagado/);
});
test('apagar um cadastro remove a chave e os pais vazios; histórico fica limitado a 300',async()=>{
 const historico=Array.from({length:300},(_,i)=>({em:'x'+i,caminho:['operacao','2026-01'],anterior:null,novo:null}));
 const naNuvem={parametros:{tributos:{'2.4.2':{local:'MG'}},historico}};
 const c=context({cfg:structuredClone(naNuvem)});nuvem(c,{cfg:naNuvem});
 await c.run("salvarParametros(['tributos','2.4.2'],null,{local:'MG'})");
 const p=c.chamadas[1][1].cfg.parametros;assert.equal(p.tributos,undefined);
 assert.equal(p.historico.length,300);assert.deepEqual(p.historico.at(-1).anterior,{local:'MG'});assert.equal(p.historico.at(-1).novo,null);assert.equal(p.historico[0].em,'x1');
});
test('recuperar backup traz os parâmetros mas mantém o histórico de agora e registra a recuperação',()=>{
 const c=context();
 c.__b={parametros:{simples:{'2026-08':{impresilk:{anexo:'III'}}},historico:[{em:'antigo',caminho:['simples','2026-08','impresilk']}]},regras:{x:1}};
 c.__a={parametros:{historico:[{em:'h1',caminho:['operacao','2026-09']},{em:'h2',caminho:['tributos','2.4.2']}]}};
 const r=c.json("paramPrepararRestauracao(__b,__a,'2026-10-01T00:00:00Z')");
 assert.deepEqual(r.parametros.simples,c.__b.parametros.simples);assert.deepEqual(r.parametros.historico.map(h=>h.em).slice(0,2),['h1','h2']);
 assert.deepEqual(r.parametros.historico.at(-1).caminho,['restauracao']);assert.equal(r.parametros.historico.at(-1).novo.backup,'2026-10-01T00:00:00Z');
 assert.deepEqual(c.json("paramPrepararRestauracao({regras:{y:1}},__a,'x')"),{regras:{y:1}},'backup sem parâmetros não mexe');
 assert.match(ler('app.js'),/paramPrepararRestauracao\(cfg,state\.cfg,data\.exportadoEm\)/);
});
test('quem não é administrador vê os valores sem poder editar',()=>{
 const h=tela(context({admin:false}));
 assert.match(h,/Somente administradores alteram parâmetros/);
 assert.doesNotMatch(h,/type="submit"|data-param-tributo=|data-param-copiar=|param-pendente/);
 assert.ok((h.match(/<input [^>]*disabled>/g)||[]).length>=10,'campos bloqueados');
 const a=tela(context());assert.match(a,/<button class="primary" type="submit">Salvar Impresilk · Set\/2026<\/button>/);assert.match(a,/data-param-tributo="2\.4\.8"/);
});
test('"Trazer do mês anterior" só aparece quando o mês anterior tem cadastro',()=>{
 assert.doesNotMatch(tela(context()),/Trazer de Ago\/2026/);
 const h=tela(context({cfg:{parametros:{simples:{'2026-08':{impresilk:{anexo:'III'}}},operacao:{'2026-08':{estoque:1}}}}}));
 assert.equal((h.match(/Trazer de Ago\/2026/g)||[]).length,2,'Impresilk e prazos; a Universo não tem Ago cadastrado');
});
test('texto vindo do cadastro é escapado',()=>{
 const x='<img src=x onerror=alert(1)>';
 const h=tela(context({periodo:'Ago/2026',cfg:{parametros:{tributos:{'2.4.2':{local:x,observacao:x}},empresas:{impresilk:{sede:x}},historico:[{em:'2026-10-01T00:00:00Z',caminho:['tributos','2.4.2'],anterior:null,novo:{local:x}}]}}}));
 assert.doesNotMatch(h,/<img src=x/);assert.match(h,/&lt;img src=x onerror=alert\(1\)&gt;/);
});
test('a tela segue o padrão: quatro cards de um número só, gráficos com título h3 dentro do bloco e Simples logo após os cards',()=>{
 const h=tela(context());
 assert.equal((h.match(/<div class="metric metric-param"><span class="label">[^<]*<\/span><strong[^>]*>[^<]*<\/strong>/g)||[]).length,4,'um número principal por card');
 assert.ok((h.match(/<figure class="g-fig g-(empilhadas|linha-area|barras)/g)||[]).length>=2);
 assert.doesNotMatch(h,/<h2>(Quanto foi|A alíquota|Onde estão)/,'gráfico dentro do bloco não compete com o título do bloco');
 assert.equal((h.match(/<section class="chart-card param-grafico[^"]*"><div class="chart-heading"><div><h3>/g)||[]).length,3);
 assert.ok(h.indexOf('cards-controle')<h.indexOf('bloco-simples')&&h.indexOf('bloco-simples')<h.indexOf('param-tributos-titulo')&&h.indexOf('param-tributos-titulo')<h.indexOf('param-operacao-titulo'));
});
test('histórico descreve cada mudança campo a campo, do mais recente para o mais antigo',()=>{
 const h=tela(context({cfg:{parametros:{historico:[{em:'2026-10-01T10:00:00Z',caminho:['simples','2026-09','impresilk'],anterior:{anexo:'III',aliquota:null},novo:{aliquota:7.5,anexo:'III',revisadoEm:'x'}},{em:'2026-10-02T10:00:00Z',caminho:['operacao','2026-09'],anterior:null,novo:{prazoRecebimento:30}},{em:'2026-10-03T10:00:00Z',caminho:['restauracao'],anterior:null,novo:{backup:'2026-09-30T12:00:00Z'}}]}}}));
 const hist=h.slice(h.indexOf('Histórico de alterações'));
 assert.match(hist,/Recuperação de backup[\s\S]*Prazos, estoque e metas · Set\/2026[\s\S]*Prazo de recebimento: vazio → 30 dias[\s\S]*Simples · Impresilk · Set\/2026[\s\S]*Alíquota efetiva: vazio → 7,50%/);
 assert.doesNotMatch(hist,/Anexo: III → III|revisadoEm/);
});
test('a tela de Parâmetros usa o cadastro, mostra a qualidade do mês e o backup leva os parâmetros',()=>{
 const c=context();assert.match(c.run('paginasDoApp().parametros()'),/bloco-simples/);
 assert.deepEqual(c.json("configSegura({parametros:{versao:1},outra:1})"),{parametros:{versao:1}});
 assert.doesNotMatch(ler('app.js'),/qualityBar'\)\.hidden=\[[^\]]*'parametros'/,'a barra de qualidade do mês aparece em Parâmetros');
 const html=ler('index.html');assert.ok(html.indexOf('gestao.js?v=')<html.indexOf('parametros.js?v=')&&html.indexOf('app.js?v=')<html.indexOf('parametros.js?v='));
 assert.match(ler('sw.js'),/`\.\/parametros\.js\?v=\$\{V\}`/);assert.match(ler('scripts/build_site.py'),/'parametros\.js'/);
});
