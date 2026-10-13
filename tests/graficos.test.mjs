import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
function view(){
 const elements={exportCosts:{}};
 const c={document:{addEventListener(){},querySelectorAll:()=>[],getElementById:id=>elements[id]},localStorage:{getItem:()=>null},navigator:{onLine:true}};
 vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','cfo-modelo.js','cfo.js','pdf-cfo.js','app.js','gestao.js','dfc.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);
 vm.runInContext(`state.periodo='Ago/2026';state.records=[{label:'Jul/2026',cells:[{code:'1',name:'Entradas',value:100},{code:'2',name:'Saídas',value:60},{code:'2.5',name:'Fixas',value:60},{code:'2.5.3',name:'Cemig',value:0}]},{label:'Ago/2026',cells:[{code:'1',name:'Entradas',value:200},{code:'2',name:'Saídas',value:210},{code:'2.5',name:'Fixas',value:210}]}];state.D={accounts:[]};`,c);
 return {c,elements};
}
test('as áreas analíticas renderizam com mês disponível e com mês ausente',()=>{
 const {c}=view();
 for(const label of ['Ago/2026','Set/2026'])for(const f of ['renderInicio','renderCaixa','renderResultado','renderCustos']){
  const html=vm.runInContext(`state.periodo='${label}';${f}(regAtual(),F.qualidade(regAtual()))`,c);
  assert.ok(html.length>100);assert.doesNotMatch(html,/NaN|undefined|height:-/);
 }
});
test('energia ausente não aparece como zero e a conta histórica continua consultável',()=>{
 const {c}=view();const html=vm.runInContext('renderCustos(regAtual())',c);
 assert.match(html,/Energia<\/span><strong class="">Não informado/,'ausente fica sem cor');assert.match(html,/Cemig · histórico/);assert.match(html,/Jul\/2026 · Cemig: R\$ 0,00/);
});
test('exportação mensal preserva ausência, zero, cobertura e nomenclatura original',()=>{
 const {c,elements}=view();c.download=(name,content)=>{c.exported={name,content};};
 vm.runInContext('wireGraficos()',c);elements.exportCosts.onclick();
 assert.match(c.exported.content,/"2.5.3";"Cemig";"0,00";"Não informado"/);
 assert.match(c.exported.content,/"Cobertura"/);assert.match(c.exported.content,/"Nome original";"Cemig";"Não informado"/);
});
test('nomes de contas são texto escapado nos gráficos e na tabela',()=>{
 const {c}=view();const html=vm.runInContext(`state.records[0].cells.at(-1).name='<img src=x onerror=alert(1)>';renderCustos(regAtual())`,c);
 assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);
});
test('cascata de caixa fecha em centavos mesmo com resíduo negativo',()=>{
 const {c}=view();const html=vm.runInContext(`graficoPonte({label:'Jan/2026',cells:[{code:'1',value:100},{code:'2',value:80},{code:'2.5',name:'Fixas',value:100}]})`,c);
 assert.match(html,/Variação: R\$ 20,00/);assert.match(html,/Sem detalhamento \/ diferença: R\$ 20,00/);
});
test('tomDelta e dirConta: variação boa em azul e ruim em vermelho pela direção da conta (v133, C11)',()=>{
 const {c}=view();vm.runInContext(fs.readFileSync(new URL('../demonstrativos.js',import.meta.url),'utf8'),c);
 const t=(dir,d)=>vm.runInContext(`tomDelta(${JSON.stringify(dir)},${JSON.stringify(d)})`,c),dir=code=>vm.runInContext(`dirConta(${JSON.stringify(code)})`,c);
 assert.equal(t(1,10),'delta-bom');assert.equal(t(1,-10),'delta-ruim');assert.equal(t(-1,10),'delta-ruim','saída que sobe é ruim');assert.equal(t(-1,-10),'delta-bom','saída que cai é boa');
 for(const [d,v] of [[0,10],[1,0],[1,null],[1,'x'],[null,5]])assert.equal(t(d,v),'',`neutro: ${d} ${v}`);
 assert.equal(t(-1,'-3'),'delta-bom','número em texto vale');
 assert.equal(dir('1'),1);assert.equal(dir('2'),-1);assert.equal(dir('1.1.1'),1,'venda');assert.equal(dir('2.5.3'),-1,'despesa fixa');assert.equal(dir('2.12'),-1,'materiais');
 for(const code of ['2.13','2.13.6','2.14','2.14.2','1.4','1.4.2','2.16','2.18'])assert.equal(dir(code),0,code+': dívida, sócios, empréstimos, investimentos e transferências ficam neutros');
 assert.equal(c.dirConta.length,1);
});
test('cor das barras: estorno de saída azul, série por sinal com duas chaves na legenda (C13, C24)',()=>{
 const {c}=view();const rows=JSON.stringify([{label:'Jan/2026',qualidade:{comparavel:true,rotulo:'ok'},reg:{},v:-50},{label:'Fev/2026',qualidade:{comparavel:true,rotulo:'ok'},reg:{},v:80}]);
 const sai=vm.runInContext(`graficoBarras(${rows},[{chave:'v',nome:'Internet',cor:'var(--chart-out)',sentido:-1}],'x')`,c);
 const barras=[...sai.matchAll(/<i style="--serie:([^;"]+);top/g)].map(m=>m[1]);assert.deepEqual(barras,['var(--chart-in)','var(--chart-out)'],'estorno (saída negativa) é dinheiro voltando');
 const sinal=vm.runInContext(`graficoBarras(${rows},[{chave:'v',nome:'Entradas menos saídas',cor:'var(--chart-net)',porSinal:true}],'x')`,c);
 assert.deepEqual([...sinal.matchAll(/<i style="--serie:([^;"]+);top/g)].map(m=>m[1]),['var(--chart-out)','var(--chart-in)']);
 assert.match(sinal,/--serie:var\(--chart-in\)"><\/i>Entradas menos saídas · Positivo<\/span><span><i style="--serie:var\(--chart-out\)"><\/i>Entradas menos saídas · Negativo/);
 const fixo=vm.runInContext(`graficoBarras(${rows},[{chave:'v',nome:'Saídas',cor:'var(--chart-out)'}],'x')`,c);
 assert.deepEqual([...fixo.matchAll(/<i style="--serie:([^;"]+);top/g)].map(m=>m[1]),['var(--chart-out)','var(--chart-out)'],'sem sentido, a cor da série vale');
});
test('ranking e estrutura do gasto: saídas só em vermelho, cor fixa pelo grupo (C2)',()=>{
 const {c}=view();const h=vm.runInContext('rankingCustos(regAtual())',c);
 assert.doesNotMatch(h,/--cost-/);assert.match(h,/--serie:var\(--chart-out\)/);
 const m=JSON.parse(vm.runInContext("JSON.stringify(coresCategorias(['2.5','2.12','2.1','2.6','~outros']))",c));
 assert.equal(m['2.12'],'var(--g-risco-3)');assert.equal(m['2.1'],'var(--g-risco-4)');assert.equal(m['~outros'],'var(--g-outros)');
 assert.equal(new Set(['2.5','2.12','2.1','2.6'].map(k=>m[k])).size,4,'quatro grupos, quatro tons');
 assert.ok(Object.values(m).every(x=>/g-risco-|g-outros/.test(x)),'nenhuma saída azul ou verde');
 assert.equal(vm.runInContext("corCategoria('2.1',3)",c),vm.runInContext("corCategoria('2.1',0)",c),'mesmo grupo, mesma cor em qualquer posição');
});
test('faixa de comparação do Dashboard: sem sinal de menos, palavra e cor pela direção (C28, C29)',()=>{
 const {c}=view();vm.runInContext(fs.readFileSync(new URL('../demonstrativos.js',import.meta.url),'utf8'),c);
 vm.runInContext("state.comparar='Jul/2026';F.comparacao=()=>({permitida:true,ressalva:false,delta:-50});F.compararConta=(a,b,code)=>({delta:code==='1'?100:150})",c);
 const h=vm.runInContext('comparativoMovimento(regAtual())',c);
 assert.match(h,/Entradas <b class="delta-bom">▲ R\$\s100,00 a mais<\/b>/);assert.match(h,/Saídas <b class="delta-ruim">▲ R\$\s150,00 a mais<\/b>/);
 assert.match(h,/Variação <b class="delta-ruim">▼ R\$\s50,00 a menos<\/b>/,'variação do caixa caindo é ruim, como na DRE');
 assert.doesNotMatch(h,/-R\$/);
});
test('Ver os valores: dinheiro com a cor da marca na cascata, nas empilhadas e nas barras (C21)',()=>{
 const {c}=view();
 const cas=vm.runInContext("gCascata([{rotulo:'Vendas',valor:100,total:true},{rotulo:'(−) DAS',valor:-6},{rotulo:'(=) Resultado',valor:94,total:true}])",c);
 assert.match(cas,/<th scope="row">\(−\) DAS<\/th><td class="num tom-sai">/);assert.match(cas,/<th scope="row">Vendas<\/th><td class="num tom-entra">/);assert.match(cas,/<td class="num">−6,0%<\/td>/,'% da base continua neutro');
 const emp=vm.runInContext("gEmpilhadas([{rotulo:'Jan',valores:{fco:10,fci:-5,fcf:-2},linha:3}],{series:[{chave:'fco',rotulo:'FCO',sinal:true},{chave:'fci',rotulo:'FCI'},{chave:'fcf',rotulo:'FCF'}],linha:{rotulo:'Saldo'}})",c);
 assert.match(emp,/<th scope="row">Jan<\/th><td class="num tom-entra">[^<]*<\/td><td class="num">[^<]*<\/td><td class="num">[^<]*<\/td><td class="num">/,'só a série com sinal ganha cor; a linha fica neutra');
 assert.match(emp,/class="g-marca-dado g-cor-entrada"/);assert.match(emp,/FCO positivo/);assert.match(emp,/FCO negativo/);
 const neg=vm.runInContext("gEmpilhadas([{rotulo:'Jan',valores:{fco:-10}}],{series:[{chave:'fco',rotulo:'FCO',sinal:true}]})",c);assert.match(neg,/g-cor-saida/);
 const todas=vm.runInContext("gEmpilhadas([{rotulo:'Jan',valores:{fco:10,fci:-5}}],{series:[{chave:'fco',rotulo:'FCO'},{chave:'fci',rotulo:'FCI'}],tomPorSinal:true})",c);
 assert.match(todas,/<td class="num tom-entra">[^<]*<\/td><td class="num tom-sai">/);
 const bar=vm.runInContext("gBarrasOrdenadas([{rotulo:'Materiais',valor:40},{rotulo:'Estorno',valor:-5},{rotulo:'Nova',valor:null}],{cor:'saida'})",c);
 assert.match(bar,/<th scope="row">Materiais<\/th><td class="num tom-sai">/);assert.match(bar,/<th scope="row">Estorno<\/th><td class="num tom-entra">/);assert.match(bar,/<th scope="row">Nova<\/th><td class="num">Não apurado/);
 assert.match(vm.runInContext("gBarrasOrdenadas([{rotulo:'A',valor:3}],{cor:'saida',formato:v=>v+' achado(s)'})",c),/<td class="num">3 achado\(s\)/,'contagem não é dinheiro');
});
test('percentual sem "-0%" e eixo sem "-0" (D16)',()=>{
 const {c}=view();
 assert.equal(vm.runInContext('GX.pct(-0.4,0)',c),'0%');assert.equal(vm.runInContext('GX.pct(-0.04)',c),'0,0%');assert.equal(vm.runInContext('GX.pct(-6)',c),'−6,0%');assert.equal(vm.runInContext('GX.pct(61)',c),'61,0%','uma casa fixa');
 const cas=vm.runInContext("gCascata([{rotulo:'Vendas',valor:1000,total:true},...Array.from({length:8},(_,i)=>({rotulo:'D'+i,valor:i?-100:-5})),{rotulo:'Fim',valor:195,total:true}])",c);
 assert.match(cas,/>−0,5%</,'degrau pequeno mostra uma casa em vez de "-0%"');assert.doesNotMatch(cas,/>[-−]0%</);
 const lin=vm.runInContext("graficoLinhas([{label:'Jan/2026',valores:{a:30}},{label:'Fev/2026',valores:{a:32}}],[{id:'a',nome:'A',cor:'red'}],'x')",c);
 assert.doesNotMatch(lin,/>-0%</);
});
test('linha com área: rótulos espaçados com muitos pontos e eixo de semana (D12, I31)',()=>{
 const {c}=view();
 const meses=JSON.stringify(Array.from({length:20},(_,i)=>({rotulo:'M'+i,valor:i})));
 const h=vm.runInContext(`gLinhaArea(${meses},{selecionado:5})`,c),rots=[...h.matchAll(/<span class="g-rot g-rot-x[^"]*" style="([^"]*)">M(\d+)</g)];
 const vis=rots.filter(m=>!/display:none/.test(m[1])).map(m=>Number(m[2]));
 assert.deepEqual(vis,[3,5,7,11,15,19],'a cada 4, contando do último, e o selecionado');
 const pocos=vm.runInContext("gLinhaArea([{rotulo:'Jan',valor:1},{rotulo:'Fev',valor:2}])",c);assert.doesNotMatch(pocos,/display:none/);
 const sem=vm.runInContext("gLinhaArea([{rotulo:'05/07',valor:1},{rotulo:'12/07',valor:null},{rotulo:'19/07',valor:3}])",c);
 assert.match(sem,/<th scope="col">Semana<\/th>/);assert.match(sem,/Há semanas sem dado\./);
 assert.match(vm.runInContext("gLinhaArea([{rotulo:'Jan',valor:1}],{eixo:'Mês'})",c),/<th scope="col">Mês<\/th>/);
});
test('régua do mês: referência de até 12 meses completos anteriores e texto do ano anterior condicionado (I13, I4)',()=>{
 const {c}=view();
 vm.runInContext(`var mk=(m,a,v)=>({label:m+'/'+a,company:'X',basis:'B',origem:'erp',qualidade:{ate:new Date(Date.UTC(a,PT_MON.indexOf(m)+1,0)).toISOString().slice(0,10),estado:'aguardando-conferencia',regra:'r',escopo:'e'},cells:[{code:'1',name:'E',value:v},{code:'2',name:'S',value:v/2}]});
  F.mesesDeReferencia=rs=>rs;state.records=[...PT_MON.map(m=>mk(m,2025,100)),...PT_MON.slice(0,8).map(m=>mk(m,2026,1000))];state.periodo='Mai/2026';`,c);
 const h=vm.runInContext('relatorioRegua()',c);
 assert.match(h,/referência dos 12 meses anteriores/);assert.match(h,/meses já completos/);assert.doesNotMatch(h,/meses fechados/);
 assert.doesNotMatch(h,/ainda não existe/,'com Mai/2025 na base, o comparativo do ano anterior existe');
 assert.match(h,/média R\$\s400,00/,'Jun/2025 a Abr/2026: 8 meses de 100 e 4 de 1.000, sem meses posteriores');
 vm.runInContext("state.records=PT_MON.slice(0,8).map(m=>mk(m,2026,1000));state.periodo='Ago/2026'",c);
 const novo=vm.runInContext('relatorioRegua()',c);assert.match(novo,/ainda não existe/);assert.match(novo,/referência dos 7 meses anteriores/);
});
test('ritmo do ano: com o mês em andamento, o veredito cita o mês completo e o valor (I12)',()=>{
 const {c}=view();
 vm.runInContext(`state.cfg={gestao:{'metas:2026':{receita:1200,custos:null,caixa:null}}};
  var mk=(m,ate,v,parcial)=>({label:m+'/2026',company:'X',basis:'B',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'r',escopo:'e'},cells:[{code:'1',name:'E',value:v},{code:'2',name:'S',value:v/2}]});
  state.records=[mk('Jan','2026-01-31',100),mk('Fev','2026-02-28',100),mk('Mar','2026-03-05',100)];state.periodo='Mar/2026';`,c);
 const h=vm.runInContext('graficoRitmoAno()',c);
 assert.match(h,/ritmo-situacao ruim">Fora do ritmo em Fev\/2026: R\$\s200,00 de R\$\s200,00 esperados|ritmo-situacao bom">No ritmo em Fev\/2026: R\$\s200,00 de R\$\s200,00 esperados/);
 assert.match(h,/viewBox="0 0 300 210"/);
});

// v134 (decisão do dono): o primeiro degrau da cascata (Vendas, Receita bruta, A receber) sai azul; a legenda só traz as cores usadas.
test('cascata: primeiro degrau azul com op.inicio, legenda só com as cores que aparecem',()=>{
 const {c:v}=view(),c={run:x=>vm.runInContext(x,v)};
 const h=c.run(`gCascata([{rotulo:'Vendas',valor:1000,total:true},{rotulo:'(−) Custos',valor:-400},{rotulo:'(=) Margem',valor:600,total:true}],{base:1000,inicio:'entrada'})`);
 const cores=[...h.matchAll(/<rect class="g-marca-dado g-cor-(\w+)"/g)].map(m=>m[1]);
 assert.deepEqual(cores,['entrada','saida','resultado']);
 const leg=h.slice(h.indexOf('g-legenda'),h.indexOf('</div>',h.indexOf('g-legenda')));
 assert.match(leg,/g-cor-entrada[^<]*<\/i>Vendas/);assert.match(leg,/Desconta/);assert.match(leg,/Subtotal/);assert.doesNotMatch(leg,/>Soma</);
 const sem=c.run(`gCascata([{rotulo:'Vendas',valor:1000,total:true},{rotulo:'(−) Custos',valor:-400},{rotulo:'(=) Margem',valor:600,total:true}],{base:1000})`);
 assert.match(sem,/<rect class="g-marca-dado g-cor-resultado"/,'sem op.inicio, continua subtotal');assert.doesNotMatch(sem.slice(sem.indexOf('g-legenda')),/g-cor-entrada/,'nenhuma soma azul: a legenda não promete azul');
});

// v135
test('dicas com a cor do valor: barras pela cor da barra e degraus da cascata com data-tom (C18)',()=>{
 const {c}=view();const rows=JSON.stringify([{label:'Jan/2026',qualidade:{comparavel:true,rotulo:'ok'},reg:{},v:-50},{label:'Fev/2026',qualidade:{comparavel:true,rotulo:'ok'},reg:{},v:80},{label:'Mar/2026',qualidade:{comparavel:true,rotulo:'ok'},reg:{},v:null}]);
 const dica=h=>[...h.matchAll(/<span class="chart-tooltip">[\s\S]*?<strong class="([^"]*)">/g)].map(m=>m[1]);
 assert.deepEqual(dica(vm.runInContext(`graficoBarras(${rows},[{chave:'v',nome:'Saídas',cor:'var(--chart-out)'}],'x')`,c)),['tom-sai','tom-sai',''],'Saídas em vermelho; sem valor, sem cor');
 assert.deepEqual(dica(vm.runInContext(`graficoBarras(${rows},[{chave:'v',nome:'Entradas menos saídas',cor:'var(--chart-net)',porSinal:true}],'x')`,c)),['tom-sai','tom-entra',''],'por sinal: negativo vermelho, positivo azul');
 assert.deepEqual(dica(vm.runInContext(`graficoBarras(${rows},[{chave:'v',nome:'Resultado',cor:'var(--chart-net)'}],'x')`,c)),['','',''],'cor neutra fica sem tom');
 const cas=vm.runInContext("gCascata([{rotulo:'Vendas',valor:100,total:true},{rotulo:'(−) DAS',valor:-6},{rotulo:'(=) Resultado',valor:94,total:true}],{inicio:'entrada'})",c);
 assert.deepEqual([...cas.matchAll(/<rect class="g-marca-dado g-cor-(\w+)"[^>]*data-tom="([^"]*)"/g)].map(m=>m[1]+'|'+m[2]),['entrada|tom-entra','saida|tom-sai','resultado|']);
 // a dica monta a primeira linha como texto e o valor num <b> com o tom, sem innerHTML
 const js=fs.readFileSync(new URL('../graficos.js',import.meta.url),'utf8'),liga=js.slice(js.indexOf('function ligarDicasGraficos'),js.indexOf('const GRAFICOS_EXEMPLOS'));
 assert.match(liga,/createElement\('b'\)/);assert.match(liga,/getAttribute\('data-tom'\)/);assert.doesNotMatch(liga,/innerHTML/);
});
test('parcial (*) fora do gráfico não se passa por "sem dado" na linha e nas empilhadas (D11)',()=>{
 const {c}=view();
 const h=vm.runInContext("gLinhaArea([{rotulo:'Set*',valor:null},{rotulo:'Out',valor:null},{rotulo:'Ago',valor:1}])",c);
 assert.match(h,/<th scope="row">Set\*<\/th><td class="num">Parcial, fora do gráfico<\/td>/);assert.match(h,/<th scope="row">Out<\/th><td class="num">Não apurado<\/td>/);
 assert.match(h,/data-dica="Set\*\nparcial, fora do gráfico"/);assert.match(h,/data-dica="Out\nsem dado"/);assert.match(h,/sem dado ou parcial \(\*\)/);
 assert.doesNotMatch(vm.runInContext("gLinhaArea([{rotulo:'Out',valor:null},{rotulo:'Ago',valor:1}])",c),/parcial/,'sem *, a legenda continua "sem dado"');
 const e=vm.runInContext("gEmpilhadas([{rotulo:'Jan',valores:{a:1,b:2}},{rotulo:'Fev*',valores:{}},{rotulo:'Mar',valores:{}}],{series:[{chave:'a',rotulo:'A'},{chave:'b',rotulo:'B'}]})",c);
 assert.match(e,/<th scope="row">Fev\*<\/th><td class="num">Parcial, fora do gráfico<\/td><td class="num">Parcial, fora do gráfico<\/td>/);
 assert.match(e,/<th scope="row">Mar<\/th><td class="num">Não apurado<\/td>/);assert.match(e,/data-dica="Fev\*\nA: parcial, fora do gráfico\nB: parcial, fora do gráfico"/);assert.match(e,/sem dado ou parcial \(\*\)/);
});
test('linha com área: op.min e op.max entram na escala e os vizinhos do mês escolhido podem sumir no estreito (D42)',()=>{
 const {c}=view(),eixo=h=>[...h.matchAll(/g-rot g-rot-y" style="top:[^"]*">([^<]*)</g)].map(m=>m[1]);
 const a=vm.runInContext("gLinhaArea([{rotulo:'Jan',valor:2},{rotulo:'Fev',valor:3}],{min:0,max:8})",c),b=vm.runInContext("gLinhaArea([{rotulo:'Jan',valor:6},{rotulo:'Fev',valor:7.5}],{min:0,max:8})",c);
 assert.deepEqual(eixo(a),eixo(b),'mesma régua nas duas empresas');
 const meses=JSON.stringify(['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m,i)=>({rotulo:m,valor:i})));
 const h=vm.runInContext(`gLinhaArea(${meses},{selecionado:7})`,c),rot=Object.fromEntries([...h.matchAll(/<span class="g-rot g-rot-x([^"]*)"[^>]*>(\w+)</g)].map(m=>[m[2],m[1]]));
 assert.match(rot.Jul,/g-opcional/);assert.match(rot.Set,/g-opcional/);assert.doesNotMatch(rot.Ago,/g-opcional/);assert.match(rot.Ago,/g-selecionado/);assert.doesNotMatch(rot.Mai,/g-opcional/,'par longe do escolhido continua');
});
test('sinal de menos tipográfico no dinheiro e no eixo, sem "-0" (D37)',()=>{
 const {c}=view();
 assert.equal(vm.runInContext('GX.moeda(-1)',c),'−R$ 1,00');assert.equal(vm.runInContext('GX.moeda(-0)',c),'R$ 0,00');assert.equal(vm.runInContext('GX.moeda(1700)',c),'R$ 1.700,00');
 assert.equal(vm.runInContext('compacto(-1500)',c),'−1,5 mil');assert.equal(vm.runInContext('compacto(-0)',c),'0');
 assert.equal(vm.runInContext('GX.curto(-1500)',c),'−R$ 1,5 mil');
});
test('textos: Demais grupos, metas apontam Parâmetros, DRE sem o gráfico da DFC e linhas sem leitura duplicada (I26, I32, D21, N26)',()=>{
 const {c,elements}=view();vm.runInContext(fs.readFileSync(new URL('../demonstrativos.js',import.meta.url),'utf8'),c);elements.metasForm={};
 vm.runInContext("state.records[1].cells.push(...Array.from({length:8},(_,i)=>({code:'2.'+(i+6),name:'G'+i,value:i+1})))",c);
 const rk=vm.runInContext('rankingCustos(regAtual(),"2",6)',c);assert.match(rk,/Demais grupos \(\d+\)/);assert.doesNotMatch(rk,/Demais categorias/);
 vm.runInContext("var __dlg='';dialog=(t,h)=>{__dlg=h;};formularioMetas()",c);
 assert.match(vm.runInContext('__dlg',c),/<p class="hint">A meta de resultado de cada mês fica em Parâmetros e entra em Preço e equilíbrio\.<\/p>/);
 const rel=vm.runInContext('relatoriosDRE()',c);
 assert.match(rel,/<button type="button" class="text-button" data-go="dfc">O que mexeu o caixa em cada mês: ver no Fluxo de caixa DFC →<\/button>/);assert.doesNotMatch(rel,/<h2>O que mexeu o caixa/);
 assert.equal(typeof c.blocosDoCaixa,'function','a DFC e os testes dela continuam usando blocosDoCaixa');
 assert.match(vm.runInContext("graficoLinhas([{label:'Jan/2026',valores:{a:30}},{label:'Fev/2026',valores:{a:32}}],[{id:'a',nome:'A',cor:'red'}],'x')",c),/<svg class="linhas-chart" aria-hidden="true"/);
});
test('sem travessão em frase nos textos da frente (I34)',()=>{
 for(const f of ['graficos.js','demonstrativos.js','financeiro.js','dre-modelo.js']){
  const js=fs.readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(js,/\S\s—\s(?!=\s|significa)\S/,f);
 }
});
