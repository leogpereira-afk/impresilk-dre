// Biblioteca de gráficos (Fase 1.5): funções puras g*, fórmulas, lacunas e acessibilidade.
// A regra que mais importa aqui: valor ausente vira lacuna "sem dado", nunca zero.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
function context(){
 const c={structuredClone,document:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true}};
 vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js'])vm.runInContext(ler(f),c);
 c.run=s=>vm.runInContext(s,c);return c;
}
const c=context();const g=(fn,...args)=>c.run(`${fn}(...${JSON.stringify(args)})`);
const linhasTabela=h=>(h.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g)||[]).length;
const caminhoLinha=h=>h.match(/<path class="g-linha[^"]*" d="([^"]*)"/)?.[1]||'';

test('toda figura tem leitura acessível e a tabela com os mesmos valores',()=>{
 const X=c.run('GRAFICOS_EXEMPLOS');
 const figs={cascata:g('gCascata',X.cascata),empilhadas:g('gEmpilhadas',X.empilhadas,{series:[{chave:'fco',rotulo:'Operação'},{chave:'fci',rotulo:'Investimento'},{chave:'fcf',rotulo:'Financiamento'}],linha:{rotulo:'Saldo'}}),cem:g('gCemPorCento',X.aging),barras:g('gBarrasOrdenadas',X.barras),linha:g('gLinhaArea',X.linha),bullet:g('gBullet',X.bullet),heat:g('gHeatmap',X.heatmap.linhas,X.heatmap.colunas),ciclo:g('gCiclo',X.ciclo)};
 for(const [k,h] of Object.entries(figs)){
  assert.match(h,/<div class="g-plot" tabindex="0" role="img" aria-label="[^"]{20,}"/,k+': leitura em aria-label');
  assert.match(h,/<details class="g-tabela"><summary>Ver os valores<\/summary><table/,k+': tabela em details');
 }
 assert.equal(linhasTabela(figs.cascata),X.cascata.length);assert.equal(linhasTabela(figs.empilhadas),12);assert.equal(linhasTabela(figs.cem),X.aging.length+1);
});
test('linha: mês sem dado vira lacuna, nunca zero nem interpolação',()=>{
 const h=g('gLinhaArea',[{rotulo:'Jan',valor:10},{rotulo:'Fev',valor:null},{rotulo:'Mar',valor:30},{rotulo:'Abr',valor:40}]);
 const d=caminhoLinha(h);assert.equal((d.match(/M/g)||[]).length,2,'dois trechos, sem ligar Jan a Mar');
 assert.equal((d.match(/L/g)||[]).length,1,'só Mar→Abr é ligado');
 assert.match(h,/class="g-sem-dado"/);assert.match(h,/sem dado/);assert.match(h,/<th scope="row">Fev<\/th><td class="num">Não apurado<\/td>/);
 assert.match(g('gLinhaArea',[{rotulo:'Jan',valor:null}]),/Não apurado: nenhum ponto com valor/);
});
test('cascata: soma degrau a degrau, margem sobre a base e lacuna que não inventa o próximo degrau',()=>{
 const h=g('gCascata',[{rotulo:'Receita',valor:100,total:true},{rotulo:'DAS',valor:-6},{rotulo:'Sem dado',valor:null},{rotulo:'Custos',valor:-40},{rotulo:'Resultado',valor:54,total:true}]);
 assert.match(h,/data-dica="DAS\n-R\$\s6,00 · -6% da base"/);
 assert.equal((h.match(/class="g-sem-dado"/g)||[]).length,2,'o degrau ausente e o seguinte (sem ponto de partida) ficam sem dado');
 assert.match(h,/Resultado[\s\S]*54% da base/);
 assert.equal((h.match(/class="g-marca-dado g-cor-resultado"/g)||[]).length,2);assert.equal((h.match(/class="g-marca-dado g-cor-saida"/g)||[]).length,1);
});
test('empilhadas: um eixo só, mês incompleto hachurado e excedente de séries em Outros',()=>{
 const h=g('gEmpilhadas',[{rotulo:'Jan',valores:{a:10,b:-5,c:2,d:1},linha:8},{rotulo:'Fev',valores:{a:10,b:null,c:2,d:1},linha:null}],{series:[{chave:'a',rotulo:'A'},{chave:'b',rotulo:'B'},{chave:'c',rotulo:'C'},{chave:'d',rotulo:'D'}],linha:{rotulo:'Saldo'}});
 assert.match(h,/Outros/);assert.doesNotMatch(h,/>D</,'a quarta série não ganha identidade própria');
 assert.equal((h.match(/class="g-sem-dado"/g)||[]).length,1);
 assert.equal((h.match(/g-rot-y/g)||[]).length,new Set(h.match(/g-rot g-rot-y" style="top:[^"]+"/g)).size,'um único conjunto de rótulos verticais');
 assert.doesNotMatch(h,/g-eixo-2|segundo eixo/);
});
test('100%: percentuais inteiros somam 100 e faixa sem valor impede a composição',()=>{
 assert.deepEqual([...c.run('GX.percentuais([1,1,1])')],[34,33,33]);
 assert.equal(c.run('GX.percentuais([52000,9000,6000,4000,2500])').reduce((s,v)=>s+v,0),100);
 assert.match(g('gCemPorCento',[{rotulo:'A vencer',valor:10},{rotulo:'1 a 15',valor:null}]),/Não apurado/);
 assert.match(g('gCemPorCento',[{rotulo:'A',valor:0},{rotulo:'B',valor:0}]),/Nenhum valor/);
});
test('barras ordenadas: maior primeiro, excedente em Outros com a soma preservada, ausente fica à parte',()=>{
 const itens=[{rotulo:'a',valor:5},{rotulo:'b',valor:50},{rotulo:'c',valor:20},{rotulo:'d',valor:1},{rotulo:'e',valor:2},{rotulo:'f',valor:3},{rotulo:'g',valor:4},{rotulo:'h',valor:null}];
 const h=g('gBarrasOrdenadas',itens,{limite:4});
 const nomes=[...h.matchAll(/<span class="g-nome"[^>]*>([^<]+)<\/span>/g)].map(m=>m[1]);
 assert.deepEqual(nomes,['b','c','a','Outros (4)','h']);
 assert.match(h,/data-dica="Outros \(4\)\nR\$\s10,00"/,'Outros soma d+e+f+g = 10');
 assert.match(h,/<th scope="row">h<\/th><td class="num">Não apurado<\/td>/);
});
test('ciclo financeiro = PME + PMR − PMPF; negativo é explicado; prazo ausente não vira zero',()=>{
 assert.equal(c.run('GX.ciclo(18,42,35)'),25);assert.equal(c.run('GX.ciclo(10,20,45)'),-15);assert.equal(c.run('GX.ciclo(10,null,45)'),null);
 assert.match(g('gCiclo',{pme:18,pmr:42,pmpf:35},{custo:21500}),/Ciclo operacional 60 dias · ciclo financeiro 25 dias · custo do ciclo R\$\s21\.500,00/);
 assert.match(g('gCiclo',{pme:10,pmr:20,pmpf:45}),/Ciclo financeiro \(negativo\)[\s\S]*os fornecedores financiam/);
 assert.match(g('gCiclo',{pme:18,pmr:null,pmpf:35}),/Não apurado: falta o prazo de recebimento/);
});
test('bullet mostra realizado sobre a meta e não aceita meta ausente',()=>{
 assert.match(g('gBullet',{realizado:84000,meta:100000}),/84% da meta/);
 assert.match(g('gBullet',{realizado:84000,meta:null}),/Não apurado: falta a meta/);
 assert.match(g('gBullet',{realizado:null,meta:100}),/Não apurado: falta o realizado/);
});
test('heatmap: intensidade relativa à linha e célula ausente hachurada',()=>{
 const h=g('gHeatmap',[{rotulo:'A',valores:[10,20,null,50]}],['Jan','Fev','Mar','Abr']);
 assert.match(h,/class="g-celula g-cor-seq-1" data-dica="A · Jan\nR\$\s10,00"/);
 assert.match(h,/class="g-celula g-cor-seq-2" data-dica="A · Fev\nR\$\s20,00"/);
 assert.match(h,/class="g-celula g-cor-seq-5" data-dica="A · Abr\nR\$\s50,00"/);
 assert.match(h,/class="g-celula g-sem-dado-cel" data-dica="A · Mar\nsem dado"/);
});
test('sparkline sem eixo nem rótulo, com lacuna e leitura',()=>{
 const h=g('gSparkline',[1,2,null,4]);assert.equal((caminhoLinha(h).match(/M/g)||[]).length,2);assert.match(h,/role="img" aria-label="Tendência de 4 meses[^"]*há meses sem dado"/);
 assert.doesNotMatch(h,/g-rot/);
});
test('rótulos vindos de fora são escapados',()=>{
 const h=g('gBarrasOrdenadas',[{rotulo:'<img src=x onerror=alert(1)>',valor:1}]);assert.doesNotMatch(h,/<img src=x/);assert.match(h,/&lt;img/);
});
test('CSS: tokens nos dois temas, fonte nunca abaixo de 11px e menos movimento respeitado',()=>{
 const css=ler('graficos.css');
 const tokens=b=>new Set([...b.matchAll(/(--g-[a-z0-9-]+):/g)].map(m=>m[1]));
 const claro=tokens(css.match(/:root\{([\s\S]*?)\n\}/)[1]),escuro=tokens(css.match(/body\.dark\{([\s\S]*?)\n\}/)[1]);
 for(const t of ['--g-entrada','--g-saida','--g-resultado','--g-atencao','--g-risco','--g-marca','--g-serie-2','--g-serie-3','--g-risco-4','--g-seq-5'])assert.ok(claro.has(t)&&escuro.has(t),t+' nos dois temas');
 for(const m of css.matchAll(/font-size:(\d+(?:\.\d+)?)px/g))assert.ok(Number(m[1])>=11,'fonte de '+m[1]+'px');
 assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/@keyframes g-surge\{[^}]*\}/);assert.match(css,/animation:g-surge \.18s/);
});
test('a biblioteca não tem cor fixa no JavaScript: só classes com significado',()=>{
 const js=ler('graficos.js'),i=js.indexOf('BIBLIOTECA DE GRÁFICOS (Fase 1.5');assert.ok(i>0);
 assert.doesNotMatch(js.slice(i),/#[0-9a-fA-F]{3,8}\b/);
});
test('galeria do Glossário desenha os nove exemplos e avisa que os números são fictícios',()=>{
 const h=c.run('galeriaGraficos()');assert.equal((h.match(/<figure class="g-fig /g)||[]).length,8);assert.match(h,/class="g-spark"/);assert.match(h,/números fictícios/);
 assert.match(c.run('renderGlossario()'),/Como ler os gráficos do painel/);
});
test('a classe do tipo de figura não se repete por dentro (senão a regra do miolo encolhe a figura inteira)',()=>{
 const X=c.run('GRAFICOS_EXEMPLOS');
 const figs=[g('gCascata',X.cascata),g('gCemPorCento',X.aging),g('gBarrasOrdenadas',X.barras),g('gLinhaArea',X.linha),g('gBullet',X.bullet),g('gHeatmap',X.heatmap.linhas,X.heatmap.colunas),g('gCiclo',X.ciclo)];
 for(const h of figs){
  const tipo=h.match(/^<figure class="g-fig g-([a-z-]+)/)[1],miolo=h.slice(h.indexOf('>')+1);
  assert.doesNotMatch(miolo,new RegExp(`class="(?:[^"]* )?g-${tipo}(?: [^"]*)?"`),'g-'+tipo+' aparece dentro da própria figura');
 }
 assert.match(ler('graficos.css'),/\.g-barras \.g-trilho,\.g-ciclo \.g-trilho\{margin-right:\d+px\}/,'barras ordenadas e ciclo reservam espaço para o valor da ponta');
});
test('no celular: cascata troca rótulos por uma linha de resultado e o heatmap não tira célula da grade',()=>{
 const X=c.run('GRAFICOS_EXEMPLOS'),h=g('gCascata',X.cascata),css=ler('graficos.css');
 assert.equal((h.match(/class="g-rot( g-rot-forte)? g-opcional" style="left:[^"]*;top:/g)||[]).length,8,'todo rótulo de valor some no estreito');
 assert.match(h,/<p class="g-resumo-estreito">\(=\) EBITDA: <b>R\$\s18\.000,00<\/b> · 18% da base<\/p>/);
 const heat=g('gHeatmap',X.heatmap.linhas,X.heatmap.colunas);
 assert.doesNotMatch(heat.slice(heat.indexOf('g-heat-grade')),/g-opcional/,'display:none dentro da grade desloca as células');
 assert.equal((heat.match(/class="g-cab g-cab-impar"/g)||[]).length,6);
 const estreito=css.match(/@container \(max-width:520px\)\{\n([\s\S]*?)\n\}/)[1];
 assert.match(estreito,/\.g-heat \.g-cab-impar\{visibility:hidden\}/);assert.match(estreito,/\.g-resumo-estreito\{display:block\}/);
});
test('cores de texto, grade e superfície seguem o tema escuro (não ficam presas no :root)',()=>{
 const css=ler('graficos.css'),raiz=css.match(/:root\{([\s\S]*?)\n\}/)[1],corpo=css.match(/\nbody\{([\s\S]*?)\n\}/)[1];
 assert.doesNotMatch(raiz,/var\(--(text|muted|surface|line)\b|--g-hachura/,'apelido no :root congela a cor do tema claro');
 for(const t of ['--g-superficie','--g-texto','--g-texto-2','--g-grade','--g-hachura'])assert.match(corpo,new RegExp(t+':'),t+' no body');
});
test('ligar as dicas sem DOM não quebra o carregamento',()=>{assert.doesNotThrow(()=>c.run('ligarDicasGraficos(null);ligarDicasGraficos({})'));});
