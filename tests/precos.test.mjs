// Preço e ponto de equilíbrio (Fase 7): base caixa da DRE Simples, média dos três
// meses fechados, sem equilíbrio inventado e simulador de markup.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const cel=(code,name,value)=>({code,name,value});
// vendas 10.000 · Simples pago 800 (DAS 600 + DARF 200) · materiais 4.000 · salário 2.000 · ISS 200
const mes=(k=1)=>[cel('1','Receitas',10000*k),cel('1.1','Comunicação Visual',10000*k),cel('1.1.1','Produtos',10000*k),
 cel('2','Despesas',7000*k),cel('2.1','Funcionários',2000*k),cel('2.1.4','Salário',2000*k),cel('2.4','Impostos',1000*k),cel('2.4.1','DAS',600*k),cel('2.4.1.2','Impresilk',600*k),cel('2.4.3','DARF',200*k),cel('2.4.3.1','Impresilk',200*k),cel('2.4.8','ISSQN',200*k),cel('2.12','Materiais',4000*k),cel('2.12.1','Impressão',4000*k)];
const reg=(label,ate,cells)=>({id:label.replace('/','_'),label,company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',qualidade:{ate,estado:'aguardando-conferencia',regra:'caixa-v2',escopo:'compõe DRE'},cells});
const REG=[reg('Jun/2026','2026-06-30',mes(0.5)),reg('Jul/2026','2026-07-31',mes(1)),reg('Ago/2026','2026-08-31',mes(1.5)),reg('Set/2026','2026-09-30',mes(1)),reg('Out/2026','2026-10-08',mes(0.2))];
function tela({periodo='Set/2026',registros=REG,op={},simples={},admin=true}={}){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams};vm.createContext(c);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),c,{filename:f});
 c.run=s=>vm.runInContext(s,c);c.json=s=>JSON.parse(c.run(`JSON.stringify(${s})`));c.__r=structuredClone(registros);c.__cfg={parametros:{operacao:op,simples}};
 c.run(`dfcHoje=()=>'2026-10-10';state.records=__r;state.cfg=__cfg;state.periodo=${JSON.stringify(periodo)};state.permissoes={leitura:true,edicao:${admin},admin:${admin}}`);return c;
}
// N27: o "?" do Glossário fica dentro do rótulo; termo = data-term do botão.
const cartoes=h=>[...h.matchAll(/<div class="metric metric-param"(?: id="secao-[\w-]+")?><span class="label">([^<]*)(?: <button type="button" class="term-help" data-term="([^"]*)" aria-label="Entender [^"]*">\?<\/button>)?<\/span><strong class="([^"]*)">([^<]*)<\/strong><small>([^<]*)<\/small>/g)].map(m=>({rotulo:m[1],termo:m[2]||'',tom:m[3],valor:m[4].replace(/\s/g,' '),nota:m[5]}));

test('média dos três meses fechados: margem, índice e ponto de equilíbrio; mês parcial fora',()=>{
 const c=tela(),b=c.json("precoBase('Out/2026')");
 assert.deepEqual(b.meses,['Jul/2026','Ago/2026','Set/2026'],'Out está em andamento e fica fora');
 // média: vendas 11.667 · Simples 933 · ISS 233 · variáveis 4.667 · fixas 2.333
 assert.deepEqual([b.vendas,b.das,b.impostosVendas,b.variaveis,b.fixas,b.mc],[11666.67,933.33,233.33,4666.67,2333.33,5833.33]);
 assert.equal(b.pct.mc,50);assert.equal(b.pe,4666.67,'2.333,33 ÷ 50%');assert.equal(b.pct.das,8);
 const j=c.json("precoBase('Jul/2026')");assert.deepEqual([j.meses,j.n],[['Jun/2026','Jul/2026'],2],'só dois meses fechados até julho');
 assert.equal(c.json("precoBase('Mai/2026')"),null,'sem mês fechado: nada inventado');
});
test('sem margem positiva não há ponto de equilíbrio; nunca infinito',()=>{
 const caro=REG.map(r=>({...r,cells:r.cells.map(x=>x.code==='2.12'||x.code==='2.12.1'?{...x,value:x.value*3}:x.code==='2'?{...x,value:x.value+8000*(x.value/7000)}:x)}));
 const c=tela({registros:caro}),b=c.json("precoBase('Set/2026')");assert.ok(b.mc<0);assert.equal(b.pe,null);
 const k=cartoes(c.run('renderPrecos()'));assert.deepEqual([k[1].valor,k[0].tom],['Sem equilíbrio','tom-sai']);assert.match(k[1].nota,/nenhum volume de vendas cobre as despesas fixas/);
 assert.doesNotMatch(c.run('renderPrecos()'),/Infinity|NaN/);
});
test('tela: quatro cards, base dita, dois gráficos e o simulador, tabela do ano',()=>{
 const c0=tela({op:{'2026-09':{metaResultado:2000}}}),h=c0.run('renderPrecos()'),k=cartoes(h);
 assert.deepEqual(k.map(x=>[x.rotulo,x.tom,x.valor]),[['Margem de contribuição','tom-entra','50,0%'],['Ponto de equilíbrio','','R$ 4.666,67'],['Distância do equilíbrio','tom-entra','R$ 5.333,33'],['Despesas fixas por mês (média)','tom-sai','R$ 2.333,33']]);
 assert.match(k[0].nota,/^R\$\s5\.833,33 por mês sobre R\$\s11\.666,67 de vendas, média de Jul\/2026 a Set\/2026$/);assert.match(k[2].nota,/Vendas de Set\/2026 \(R\$\s10\.000,00\) acima do ponto de equilíbrio/);
 assert.match(h,/Para a meta de resultado do mês de R\$\s2\.000,00 em Set\/2026 \(Parâmetros; depois de juros e tarifas\), as vendas precisam chegar a R\$\s8\.666,67 por mês\./,'(2.333,33 + 2.000) ÷ 50%');
 assert.match(h,/alíquota observada de 8,0%/);
 // N27: "?" do Glossário nos três cartões com verbete; D16: uma casa fixa.
 assert.deepEqual(k.map(x=>x.termo),['Margem de contribuição','Ponto de equilíbrio','Margem de segurança','']);assert.equal(c0.run('precoPct(61)'),'61,0%');assert.equal(c0.run('precoPct(-0.04)'),'0,0%');assert.equal(c0.run('precoPct(15.87)'),'15,9%');assert.equal(c0.run('precoPct(null)'),'—');
 // N10: a tabela do ano tem nome acessível; N25: a planilha sai pelo topo.
 assert.match(h,/<div class="table-scroll" role="region" tabindex="0" aria-label="Margem e equilíbrio mês a mês"><table class="tabela-controle precos-tabela">/);assert.doesNotMatch(h,/data-precos-csv/);
 assert.equal((h.match(/<figure class="g-fig g-(empilhadas|cascata)/g)||[]).length,2);assert.match(h,/data-precos-sim/);
 assert.match(h,/<tr class="selected-month"><th scope="row">Set\/2026<\/th><td class="num tom-entra">R\$\s10\.000,00<\/td><td class="num tom-sai">R\$\s1\.000,00<\/td><td class="num tom-sai">R\$\s4\.000,00<\/td><td class="num tom-entra">R\$\s5\.000,00<\/td><td class="num">50,0%<\/td><td class="num tom-sai">R\$\s2\.000,00<\/td><td class="num">R\$\s4\.666,67<\/td><td class="num tom-entra">R\$\s5\.333,33<\/td><\/tr>/,'C6: cada coluna de dinheiro com o tom do sentido');
 assert.doesNotMatch(h.match(/<tr><th scope="row">Out\/2026 \*<\/th>.*?<\/tr>/)[0],/tom-(entra|sai)/,'C6: mês em andamento sem tom');
 assert.match(h,/<tr><th scope="row">Out\/2026 \*<\/th>[\s\S]*?<td class="num "><span class="muted"/,'mês em andamento sem distância nem cor');
 assert.match(h,/<tr><th scope="row">Jan\/2026<\/th><td class="num"><span class="muted"/,'mês sem dados: —');
 assert.match(tela().run('paginasDoApp().precos()'),/Ponto de equilíbrio/);
});
test('mês escolhido em andamento: distância não apurada; sem meses fechados: estado vazio',()=>{
 const k=cartoes(tela({periodo:'Out/2026'}).run('renderPrecos()'));assert.deepEqual([k[2].valor,k[2].tom],['Não apurado','']);assert.match(k[2].nota,/Out\/2026 ainda está em andamento/);
 const h=tela({periodo:'Mai/2026'}).run('renderPrecos()');assert.match(h,/<h2>Sem meses completos até Mai\/2026<\/h2>/);assert.deepEqual(cartoes(h).map(x=>x.valor),['Não apurado','Não apurado','Não apurado','Não apurado']);
});
test('simulador: markup divisor, impostos à escolha, fixas de hoje por padrão e "não fecha" acima de 100%',()=>{
 const c=tela({simples:{'2026-09':{impresilk:{aliquota:9.5}}}});
 const sim=(ui)=>{c.run(`Object.assign(precosUI,${JSON.stringify(ui)})`);return c.json("precoSimular(precoBase('Set/2026'),'Set/2026')");};
 assert.match(sim({custo:'',lucro:''}).texto,/Informe o custo variável/);assert.match(sim({custo:'100'}).texto,/Informe o lucro desejado/);
 // observado 8% + ISS 2% + fixas 20% + lucro 10% = 40% → 100 ÷ 0,6
 assert.deepEqual([sim({custo:'100',lucro:'10',imposto:'observado',fixas:''}).preco,sim({}).markup],[166.67,1.67]);
 assert.equal(sim({imposto:'impresilk'}).preco,Math.round(100/(1-(9.5+2+20+10)/100)*100)/100,'alíquota do PGDAS da Impresilk');
 assert.equal(sim({imposto:'universo'}).preco,Math.round(100/(1-(6+2+20+10)/100)*100)/100,'Universo sem PGDAS: padrão provisório de 6%');
 assert.equal(sim({imposto:'observado',fixas:'1.000,5'}).preco,undefined);assert.match(sim({}).texto,/Não fecha/);
 assert.equal(sim({fixas:'30',lucro:'5,5'}).preco,Math.round(100/(1-(8+2+30+5.5)/100)*100)/100,'número no formato brasileiro');
 const h=c.run('renderPrecos()');assert.match(h,/Universo \(PGDAS não informado, padrão provisório\): 6,0%/);assert.match(h,/Impresilk \(PGDAS de Set\/2026\): 9,5%/);
});
test('simulador recalcula ao digitar sem redesenhar a tela',()=>{
 const ev={},c=tela();c.__doc={addEventListener:(t,fn)=>{(ev[t]=ev[t]||[]).push(fn);}};c.run('document=__doc;wirePrecos()');
 const out={innerHTML:''},form={querySelector:()=>out};
 for(const [name,value] of [['custo','200'],['lucro','10']])for(const fn of ev.input)fn({target:{name,value,closest:()=>form}});
 assert.match(out.innerHTML,/<b>R\$\s333,33<\/b> · Preço de R\$\s333,33/);assert.equal(c.run('precosUI.custo'),'200');
 for(const fn of ev.input)fn({target:{name:'custo',value:'<img src=x>',closest:()=>form}});assert.doesNotMatch(out.innerHTML,/<img/);
});

// ── Casos da revisão da Fase 7 ────────────────────────────────────────────
const com=(cells,extra)=>{const out=cells.map(x=>({...x}));for(const [code,name,value,pai] of extra){out.push(cel(code,name,value));const t=out.find(x=>x.code===pai);t.value+=value;const r=out.find(x=>x.code===code.split('.')[0]);if(r&&r!==t)r.value+=value;}return out;};
test('distância: sem equilíbrio, mês não coletado e mês incompleto têm textos próprios',()=>{
 const caro=REG.map(r=>({...r,cells:r.cells.map(x=>x.code==='2.12'||x.code==='2.12.1'?{...x,value:x.value*3}:x.code==='2'?{...x,value:x.value+8000*(x.value/7000)}:x)}));
 assert.match(cartoes(tela({registros:caro}).run('renderPrecos()'))[2].nota,/^Sem ponto de equilíbrio: a margem de contribuição não é positiva, então não há distância\.$/);
 assert.doesNotMatch(tela({registros:caro,op:{'2026-09':{metaResultado:2000}}}).run('renderPrecos()'),/precisam chegar|atingida/,'sem margem, sem frase de meta');
 const semSet=REG.filter(r=>r.label!=='Set/2026');assert.match(cartoes(tela({registros:semSet}).run('renderPrecos()'))[2].nota,/Set\/2026 ainda não foi coletado: colete no Mubisys ou importe a planilha do mês\./);
 const incompleto=REG.map(r=>r.label==='Ago/2026'?{...r,qualidade:{...r.qualidade,ate:'2026-08-20'}}:r);
 assert.match(cartoes(tela({registros:incompleto,periodo:'Ago/2026'}).run('renderPrecos()'))[2].nota,/Ago\/2026 tem dados só até 20\/08: atualize o Mubisys ou importe a planilha completa para ver a distância\./);
});
test('média com mês pulado diz quais meses usou e o que ficou de fora; plural certo',()=>{
 const incompleto=REG.map(r=>r.label==='Ago/2026'?{...r,qualidade:{...r.qualidade,ate:'2026-08-20'}}:r),h=tela({registros:incompleto}).run('renderPrecos()');
 assert.match(h,/média de Jun\/2026, Jul\/2026 e Set\/2026 \(Ago\/2026 incompleto ficou de fora\)/);assert.doesNotMatch(h,/média de Jun\/2026 a Set\/2026/);
 const dois=tela({periodo:'Jul/2026'}).run('renderPrecos()');assert.match(dois,/\(só 2 meses completos\)/);assert.doesNotMatch(dois,/meses fechados|mês fechado/,'I4: Fechado só na Conferência');assert.doesNotMatch(dois,/mêses/);
 const c=tela(),j=c.json("precoBase('Jul/2026')");assert.deepEqual([j.vendas,j.fixas,j.mc,j.pe],[7500,1500,3750,3000]);
});
test('meta: juros e tarifas entram na conta; meta negativa não vira venda negativa',()=>{
 const juros=REG.map(r=>({...r,cells:com(r.cells,[['2.13','Bancárias',0,'2'],['2.13.1','Tarifa de boletos',1000,'2.13']])}));
 const c=tela({registros:juros,op:{'2026-09':{metaResultado:2000}}});assert.equal(c.json("precoBase('Set/2026')").financeiro,1000);
 assert.match(c.run('renderPrecos()'),/as vendas precisam chegar a R\$\s10\.666,67 por mês/,'(2.333,33 + 1.000 + 2.000) ÷ 50%');
 assert.match(tela({op:{'2026-09':{metaResultado:-5000}}}).run('renderPrecos()'),/A meta de resultado do mês de [-−]R\$\s5\.000,00 em Set\/2026 \(Parâmetros\) é atingida com qualquer venda\./);
});
test('distância negativa em vermelho, no card e na tabela',()=>{
 const regs=[reg('Jul/2026','2026-07-31',mes(2)),reg('Ago/2026','2026-08-31',mes(2)),reg('Set/2026','2026-09-30',mes(.4))],h=tela({registros:regs}).run('renderPrecos()'),k=cartoes(h);
 assert.deepEqual([k[2].valor.replace('\u2212','-'),k[2].tom],['-R$ 1.866,67','tom-sai']);assert.match(k[2].nota,/abaixo do ponto de equilíbrio/);
 assert.match(h,/<tr class="selected-month"><th scope="row">Set\/2026<\/th>[\s\S]*?<td class="num tom-sai">[-−]R\$\s1\.866,67<\/td><\/tr>/);
});
test('cascata e tabela: Simples, ISS e devoluções, resultado sem juros; percentuais com decimais',()=>{
 const regs=REG.map(r=>r.label==='Set/2026'?{...r,cells:com(r.cells,[['2.2','Administrativas',0,'2'],['2.2.6','Devolução Cliente',300,'2.2'],['2.13','Bancárias',0,'2'],['2.13.1','Tarifa',100,'2.13']])}:r);
 const c=tela({registros:regs}),h=c.run('renderPrecos()'),b=c.json("precoBase('Set/2026')");
 assert.equal(b.devolucoes,100);assert.equal(b.pct.dev,0.86,'100 ÷ 11.666,67, com duas casas');
 const cas=h.slice(h.indexOf('g-cascata'),h.indexOf('</figure>',h.indexOf('g-cascata')));
 assert.match(cas,/Simples pago<\/th><td[^>]*>[-−]R\$\s933,33/);assert.match(cas,/ISS e devoluções<\/th><td[^>]*>[-−]R\$\s333,33/);assert.match(cas,/Resultado operacional<\/th><td[^>]*>R\$\s3\.400,00/,'margem 5.733,33 − fixas 2.333,33; a tarifa não entra');
 assert.match(h,/<th scope="row">Set\/2026<\/th><td class="num tom-entra">R\$\s10\.000,00<\/td><td class="num tom-sai">R\$\s1\.300,00<\/td>/,'DAS + DARF + ISS + devolução');
 assert.match(h,/g-selecionado[^>]*>Set</);
});
test('simulador: bordas e o que foi digitado continua depois de redesenhar',()=>{
 const c=tela(),sim=ui=>{c.run(`Object.assign(precosUI,${JSON.stringify(ui)})`);return c.json("precoSimular(precoBase('Set/2026'),'Set/2026')");};
 assert.match(sim({custo:'0',lucro:'10',fixas:'',imposto:'observado'}).texto,/Informe o custo/);
 assert.match(sim({custo:'100',lucro:'70'}).texto,/Não fecha/,'8 + 2 + 20 + 70 = 100%: sem preço');
 assert.match(sim({custo:'100',lucro:'10'}).texto,/impostos 10,0%/);
 assert.match(sim({fixas:'abc'}).texto,/Informe as despesas fixas em % do preço/);
 c.run(`Object.assign(precosUI,{custo:'250',lucro:'12',fixas:'30',imposto:'impresilk'})`);const h=c.run('renderPrecos()');
 for(const re of [/name="custo"[^>]*value="250"/,/name="lucro"[^>]*value="12"/,/name="fixas"[^>]*value="30"/,/<option value="impresilk" selected>/])assert.match(h,re);
});

test('planilha (Fase 11.5): base, números, mês a mês do ano e o simulador; formato do Excel em português',()=>{
 const c=tela({periodo:'Out/2026'});c.run(`__baixado=null;download=(nome,conteudo,tipo)=>{__baixado={nome,conteudo,tipo};}`);
 assert.doesNotMatch(c.run('renderPrecos()'),/data-precos-csv/,'N25: a planilha sai pelo "↓ Planilha" do topo, que chama precosCSV');
 const rows=c.json('precosCSV()'),b=c.json('__baixado');
 assert.equal(b.nome,'preco-equilibrio-Out_2026.csv');assert.equal(b.conteudo.charCodeAt(0),0xfeff,'BOM para acentos');assert.match(b.conteudo,/;/);
 const linha=r=>rows.find(x=>x[0]===r);
 assert.deepEqual(linha('Meses da média').slice(0,2),['Meses da média','Jul/2026, Ago/2026, Set/2026']);
 assert.deepEqual(linha('Ponto de equilíbrio (vendas por mês)').slice(0,2),['Ponto de equilíbrio (vendas por mês)','4666,67']);
 assert.deepEqual(linha('Margem de contribuição (média)'),['Margem de contribuição (média)','5833,33','50,00% das vendas']);
 assert.equal(linha('Distância do equilíbrio em Out/2026')[1],'Não apurado','mês em andamento');
 assert.deepEqual(linha('Set/2026').slice(-1),['completo']);assert.deepEqual(linha('Out/2026').slice(-1),['em andamento ou incompleto']);assert.deepEqual(linha('Dez/2026').slice(1,2),['Não apurado']);
 assert.equal(rows.some(r=>r[0]==='Simulador de preço'),false,'simulador vazio não entra');
 c.run(`precosUI.custo='100';precosUI.lucro='10'`);const r2=c.json('precosCSV()');assert.ok(r2.some(r=>r[0]==='Preço'&&/^\d+,\d{2}$/.test(r[1])));
 assert.equal(tela({periodo:'Mai/2026'}).json('precosCSV()'),null,'sem meses fechados: sem planilha');
});

// ── Fase 12.2: chip Ano, comparação com o ano anterior e avaliação de cada cartão ──
const aval=h=>[...h.matchAll(/<span class="aval-selo aval-(excelente|boa|ruim)">([^<]*)<\/span><span class="aval-texto">/g)].map(m=>m[1]);
const ANOS=[...['Jul','Ago','Set'].map(m=>reg(m+'/2025',{Jul:'2025-07-31',Ago:'2025-08-31',Set:'2025-09-30'}[m],mes(.8))),...REG];
test('avaliação: margem 50% boa, fixas 20% e equilíbrio 40% das vendas excelentes, distância do mês excelente; faixas na régua',()=>{
 const h=tela().run('renderPrecos()');
 assert.deepEqual(aval(h),['boa','excelente','excelente','excelente'],'margem, equilíbrio, distância, fixas');
 assert.match(h,/sobra de 45% a 55% de cada venda: produção controlada/);assert.match(ler('glossario.js'),/Níveis de margem na comunicação visual/);assert.match(h,/40,0% das vendas médias/);assert.match(h,/Margem de segurança: 53,3% das vendas do mês/);
 assert.match(h,/aria-label="Margem de contribuição 50,0%: boa\. Faixas: excelente a partir de 55,0%, boa de 45,0% a 55,0%, ruim abaixo de 45,0%\./);
 assert.match(h,/Mesmo período de 2025: sem os mesmos meses completos/,'sem 2025 na base: diz, não inventa');
 const c=tela();assert.deepEqual(['mc','pe','seguranca','fixas'].map(k=>c.json(`precoAvaliar('${k}',${{mc:44.9,pe:70.1,seguranca:29.9,fixas:35.1}[k]})`).nivel),['ruim','ruim','ruim','ruim']);
 assert.deepEqual(['mc','pe','seguranca','fixas'].map(k=>c.json(`precoAvaliar('${k}',${{mc:55,pe:50,seguranca:50,fixas:25}[k]})`).nivel),['excelente','excelente','excelente','excelente'],'borda é do lado melhor');
 assert.equal(c.json('precoAvaliar("mc",null)'),null);
});
test('comparação com o mesmo período do ano anterior: valor de antes, diferença e cor de melhorou/piorou; comparativo ano a ano',()=>{
 const h=tela({registros:ANOS}).run('renderPrecos()');
 // 2025 em 0,8x: mesma margem (50%) e mesmo peso das fixas (20%): a diferença é pela medida da régua (% das vendas), então sem cor
 assert.match(h,/Mesmo período de 2025: 50,0%<\/span>/,'margem igual: sem diferença');assert.match(h,/aval-marca-ant/,'o ano anterior na régua');
 assert.match(h,/Mesmo período de 2025: R\$\s1\.600,00 \(20,0% das vendas\)<\/span>/,'fixas no mesmo peso das vendas: sem melhorou nem piorou');
 // fixas pesando mais em 2026 (2.000 → 2.400 sobre as mesmas vendas): vermelho em p.p.
 const mais=ANOS.map(r=>r.label.endsWith('2026')?{...r,cells:r.cells.map(x=>x.code==='2.1'||x.code==='2.1.4'?{...x,value:x.value*1.2}:x.code==='2'?{...x,value:x.value+(r.cells.find(y=>y.code==='2.1').value*.2)}:x)}:r);
 assert.match(tela({registros:mais}).run('renderPrecos()'),/Mesmo período de 2025: R\$\s1\.600,00 \(20,0% das vendas\)<b class="tom-sai"> \(\+4,0 p\.p\. nas vendas\)<\/b>/);
 assert.match(h,/Set\/2025: R\$\s4\.800,00 \(60,0%\)<b class="tom-sai"> \(−6,7 p\.p\.\)<\/b>/,'margem de segurança do mesmo mês caiu: vermelho');
 assert.match(h,/<summary><h2 class="card-titulo">Comparativo ano a ano · Jul a Set<\/h2><\/summary>/);assert.match(h,/<th scope="row">2025<\/th>/);assert.match(h,/<tr class="selected-month"><th scope="row">2026<\/th>/);
 assert.doesNotMatch(tela().run('renderPrecos()'),/Comparativo ano a ano/,'um ano só: sem comparativo');
});
test('chip Ano: média dos meses fechados do ano, distância pelas vendas médias e comparação com os mesmos meses',()=>{
 const c=tela({registros:ANOS,periodo:'Set/2026'});c.run('state.anoTodo=true');
 const b=c.json("precoBaseTela('Set/2026')");assert.deepEqual(b.meses,['Jun/2026','Jul/2026','Ago/2026','Set/2026']);
 const h=c.run('renderPrecos()'),k=cartoes(h);
 assert.equal(k[3].rotulo,'Despesas fixas por mês (média do ano)');assert.match(k[0].nota,/média de Jun\/2026 a Set\/2026 \(Jan\/2026 a Mai\/2026 sem dados ficaram de fora\) \(4 meses completos de 2026\)/);
 // D33: no Ano, o mês em andamento não fica destacado na tabela nem no gráfico
 const tab=h.slice(h.indexOf('precos-tabela'));assert.doesNotMatch(tab,/class="selected-month"/,'D33: nenhuma linha destacada no Ano');assert.equal(c.run("state.anoTodo=false;renderPrecos()").slice(c.run("renderPrecos()").indexOf('precos-tabela')).match(/class="selected-month"/g)?.length,1,'no mês, a linha do mês continua destacada');
 assert.match(k[2].nota,/^Vendas por mês \(R\$\s10\.000,00, média/);assert.match(h,/Mesmos meses de 2025/);
 assert.match(tela({registros:ANOS,periodo:'Set/2026'}).run("state.anoTodo=true;precosCSV=precosCSV;__b=null;download=(n,c)=>{__b=c};precosCSV();__b"),/Jun\/2026, Jul\/2026, Ago\/2026, Set\/2026/);
});
test('mês sem plano de contas (2.99) fica fora da média e é dito',()=>{
 const sem=REG.map(r=>r.label!=='Ago/2026'?r:{...r,cells:[cel('1','Receitas',15000),cel('1.1','Comunicação Visual',15000),cel('2','Despesas',9000),cel('2.99','Sem plano de contas',8900),cel('2.4','Impostos',100),cel('2.4.8','ISSQN',100)]});
 const c=tela({registros:sem}),b=c.json("precoBase('Set/2026')");
 assert.deepEqual(b.meses,['Jun/2026','Jul/2026','Set/2026']);assert.deepEqual(b.lacunas,[{label:'Ago/2026',motivo:'sem plano de contas'}]);
 assert.match(c.run('renderPrecos()'),/Ago\/2026 sem plano de contas ficou de fora/);
});

test('revisão 12.2: virada do ano, comparação só nos mesmos meses, sem equilíbrio no ano anterior, prejuízo, sem plano de contas, borda e planilha no Ano',()=>{
 // janeiro: base Nov a Jan compara com Nov a Jan de um ano antes, com o rótulo do intervalo
 const vira=[...['Nov','Dez'].map(m=>reg(m+'/2024',{Nov:'2024-11-30',Dez:'2024-12-31'}[m],mes(1))),reg('Jan/2025','2025-01-31',mes(1)),...['Nov','Dez'].map(m=>reg(m+'/2025',{Nov:'2025-11-30',Dez:'2025-12-31'}[m],mes(1))),reg('Jan/2026','2026-01-31',mes(1))];
 const hv=tela({registros:vira,periodo:'Jan/2026'}).run('renderPrecos()');assert.match(hv,/Mesmo período de Nov\/2024 a Jan\/2025/);assert.match(hv,/<tr class="selected-month"><th scope="row">2026<\/th>/);
 // só Set/2025 fechou: compara Set com Set (só 1 de 3 meses)
 const um=[reg('Set/2025','2025-09-30',mes(1)),...REG];const hu=tela({registros:um}).run('renderPrecos()');assert.match(hu,/\(só 1 de 3 meses, comparados com os mesmos meses de hoje\)/);
 // ano anterior fechado, mas sem equilíbrio
 const caro=c=>c.map(x=>x.code==='2.12'||x.code==='2.12.1'?{...x,value:x.value*3}:x.code==='2'?{...x,value:x.value+8000*(x.value/7000)}:x);
 const semEq=[...['Jul','Ago','Set'].map(m=>reg(m+'/2025',{Jul:'2025-07-31',Ago:'2025-08-31',Set:'2025-09-30'}[m],caro(mes(1)))),...REG];
 assert.match(tela({registros:semEq}).run('renderPrecos()'),/Mesmo período de 2025: sem ponto de equilíbrio \(margem de contribuição não positiva\)/);
 // mês abaixo do equilíbrio: o texto diz que deu prejuízo
 const c=tela();assert.match(c.json("precoAvaliar('seguranca',-40)").texto,/abaixo do equilíbrio: deram prejuízo/);assert.equal(c.json("precoAvaliar('mc',54.96)").nivel,'excelente','54,96% aparece como 55%');
 // meses coletados sem plano de contas: não manda coletar
 const semPlano=REG.map(r=>({...r,cells:[cel('1','Receitas',10000),cel('1.1','CV',10000),cel('2','Despesas',9000),cel('2.99','Sem plano',8900),cel('2.4','Impostos',100),cel('2.4.8','ISSQN',100)]}));
 const hs=tela({registros:semPlano}).run('renderPrecos()');assert.match(hs,/Meses sem plano de contas até Set\/2026/);assert.doesNotMatch(hs,/Colete os meses/);
 // planilha no Ano: distância pelas vendas médias e a margem de segurança
 const a=tela({registros:ANOS,periodo:'Set/2026'});a.run('state.anoTodo=true;__r=null;download=(n,x)=>{};');const rows=a.json('precosCSV()');
 assert.ok(rows.some(r=>/^Distância do equilíbrio \(vendas médias de 2026\)$/.test(r[0])&&r[1]==='6000,00'));assert.ok(rows.some(r=>r[0]==='Margem de segurança'&&r[1]==='60,00%'));
});
