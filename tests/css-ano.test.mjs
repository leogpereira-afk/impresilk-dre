// Ano em todas as telas com meses, frente css: linha de comparação, topo no Ano e tabelas do Ano.
import fs from 'node:fs';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const semComentario=t=>t.replace(/\/\*[\s\S]*?\*\//g,'');
const ARQ=['styles.css','compacto.css','cfo.css','graficos.css','indicadores.css'];
const c=semComentario(ler('compacto.css'));
// regras (seletor + corpo), também as de dentro de @media, de todos os arquivos
const regras=ARQ.flatMap(f=>{const t=semComentario(ler(f)),out=[];for(const m of t.matchAll(/([^{}@]+)\{([^{}]*)\}/g))out.push({f,sel:m[1].trim(),corpo:m[2]});return out;});
const CLASSES=['comp-ano','tabela-ano','param-ano-tabela','conf-ano-mes','ano-comparado'];

test('linha de comparação .comp-ano: 11 px, cinza, em linha própria; o Δ pega as cores de delta-*',()=>{
 assert.match(c,/\.comp-ano\{display:block;font-size:11px;line-height:1\.45;color:var\(--muted\);margin-top:2px[;}]/);
 assert.match(c,/\.metric>\.comp-ano\{grid-column:1\/-1\}/,'no cartão em grade a linha ocupa a largura toda');
 const cfo=ler('cfo.css');
 assert.match(cfo,/\.delta-bom\{color:var\(--blue\)\}/);assert.match(cfo,/\.delta-ruim\{color:var\(--red,#c8384d\)\}/);assert.match(cfo,/\.delta-neutro\{color:var\(--muted\)\}/);
 // nenhuma regra pinta o b da linha por cima do delta-*
 for(const r of regras)if(/\.comp-ano[^,]*\bb\b/.test(r.sel))assert.doesNotMatch(r.corpo,/(^|;)color:/,r.sel);
});

test('topo no Ano: chip e "Comparar com" sem linha nova, 44 px no celular e a lista cabe na tela',()=>{
 assert.match(c,/#anoChip\{flex-wrap:nowrap;overflow:visible;/,'o chip não herda a rolagem da barra de meses (o foco não é cortado)');
 assert.match(c,/@media\(min-width:701px\)\{\.pagehead \.period>#monthChips\{max-width:max-content\}\}/,'no computador o Ano fica logo depois de Dez');
 assert.match(c,/@media\(max-width:700px\),\(pointer:coarse\)\{#anoChip button,#periodCompare>summary\{min-height:44px\}\}/);
 assert.match(c,/#compareSelect\{max-width:calc\(100vw - 32px\)\}/);
 assert.match(c,/\.period-compare>label\{max-width:calc\(100vw - 32px\);box-sizing:border-box\}/);
 // ids que o app.js monta
 const app=ler('app.js'),html=ler('index.html');
 assert.ok(app.includes('anoChip'),'app cria #anoChip');
 for(const id of ['periodCompare','compareSummary','compareSelect'])assert.ok(html.includes(`id="${id}"`),id);
});

test('topo de 701 a 1179 px (v136, RV-1 e RV-2): meses numa linha que rola, Ano e Comparar ao lado; 44 px só no toque',()=>{
 // A medida no navegador (altura do topo no Ano igual à do mês) fica no portão visual (tests/visual/regra-cores.mjs, regra 12).
 assert.match(c,/@media\(min-width:701px\) and \(max-width:1179px\)\{\.pagehead \.period\{flex-wrap:nowrap\}\.pagehead \.period>#monthChips\{flex:1 1 0;min-width:0;flex-wrap:nowrap;overflow-x:auto\}\.pagehead \.period>#monthChips button\{flex:0 0 auto\}\}/);
 assert.doesNotMatch(c,/#monthChips\{[^}]*scrollbar-width:none/,'a barra de rolagem fica: com mouse, os meses cortados precisam aparecer');
 assert.match(c,/@media\(min-width:701px\) and \(max-width:900px\) and \(pointer:fine\)\{\.pagehead #periodCompare>summary\{min-height:0;padding-block:6px\}\}/,'com mouse, o Comparar na altura dos meses');
 assert.match(c,/@media \(min-width:701px\) and \(pointer:coarse\)\{\.pagehead \.period>#monthChips button\{min-height:44px\}\}/,'no tablet com toque, meses e Ano com 44 px');
});

test('linha de comparação, Fechamento por mês e tabelas com botão de mês (v136, RV-3 a RV-5)',()=>{
 assert.match(c,/\.comp-ano b\{font-weight:650;white-space:nowrap\}/,'a seta e o valor do Δ quebram juntos');
 assert.match(c,/\.fech-ano>li\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;align-items:center;gap:4px 12px\}/,'o "Abrir <mês>" sempre à direita');
 assert.match(c,/\.tabela-ano tr:has\(> \* > button\[data-period\]\)>\*,\.param-ano-tabela thead th\{vertical-align:middle\}/);
});

test('tabelas do Ano: rolam dentro do .table-scroll com a primeira coluna parada e números tabulares',()=>{
 assert.match(c,/\.tabela-ano,\.param-ano-tabela\{min-width:520px;font-variant-numeric:tabular-nums\}/);
 assert.match(c,/\.tabela-ano tr>:first-child,\.param-ano-tabela tr>:first-child\{position:sticky;left:0;z-index:1;background:var\(--surface\);/);
 assert.match(c,/\.tabela-ano thead tr>:first-child,\.param-ano-tabela thead tr>:first-child\{background:var\(--bg\)\}/,'cabeçalho parado com o fundo do cabeçalho');
 // a primeira coluna vence o "tbody th{background:none}" do styles.css
 assert.match(ler('styles.css'),/tbody th\{text-transform:none;letter-spacing:0;color:var\(--text\);background:none\}/);
 assert.match(ler('styles.css'),/\.table-scroll\{position:relative;overflow:auto/);
});

test('botões e grupos do Ano: botão de texto com foco visível e 44 px no toque',()=>{
 assert.match(c,/\.param-ano-tabela th button,\.tabela-ano button\[data-period\]\{font:inherit;[^}]*border:0;[^}]*background:transparent;[^}]*min-height:28px/);
 assert.match(c,/\.param-ano-tabela th button:focus-visible,\.tabela-ano button\[data-period\]:focus-visible\{outline:2px solid var\(--text\)/);
 assert.match(c,/@media \(max-width:900px\),\(pointer:coarse\)\{\.param-ano-tabela th button,\.tabela-ano button\[data-period\]\{min-height:44px;min-width:44px\}\}/);
 assert.match(c,/@media \(max-width:900px\),\(pointer:coarse\)\{details\.conf-ano-mes>summary\{min-height:44px;display:list-item;padding-block:12px;box-sizing:border-box\}\}/);
 assert.match(c,/details\.conf-ano-mes>summary:focus-visible\{outline:2px solid var\(--text\)/);
});

test('linha do ano comparado com o fundo neutro do mês selecionado',()=>{
 assert.match(c,/tbody tr\.ano-comparado>\*,\.tabela-ano tr\.ano-comparado>\*,\.param-ano-tabela tr\.ano-comparado>\*\{background:var\(--selected\)\}/);
 assert.match(c,/\.plano-juntas tr\.selected-month>td\{background:var\(--selected\)\}/,'o mesmo token do mês selecionado');
});

test('classes do Ano existem e nunca usam a cor do dinheiro (azul e vermelho só em delta-* e tom-*)',()=>{
 for(const k of CLASSES)assert.ok(regras.some(r=>r.sel.includes('.'+k)),k);
 for(const r of regras){
  if(!CLASSES.some(k=>r.sel.includes('.'+k)))continue;
  if(/\.(delta|tom)-/.test(r.sel))continue;
  assert.doesNotMatch(r.corpo,/var\(--(blue|red)\b|var\(--(chart|g)-(in|out|entrada|saida)\b/,`${r.f}: ${r.sel}`);
 }
});
