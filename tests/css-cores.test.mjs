// Auditoria v133 (lote A e B, parte de CSS): a cor do dinheiro vence no componente, sem !important
// global; status em verde e âmbar; tokens velhos fora; e o que o celular precisa (44px, tabela que não estoura a tela).
import fs from 'node:fs';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const css=['styles.css','compacto.css','cfo.css','graficos.css','indicadores.css'].map(ler).join('\n');
const bloco=(txt,sel)=>{const i=txt.indexOf(sel+'{');assert.ok(i>=0,'sem '+sel);return txt.slice(i,txt.indexOf('}',i));};
test('paleta antiga por posição e vermelho fixo do escuro saíram',()=>{
 assert.doesNotMatch(css,/--cost-\d/,'--cost-* apagado');
 assert.doesNotMatch(css,/--chart-in:#238a7b|--chart-out:#dc8653|--chart-in:#58c5b1|--chart-out:#f3ae7f/,'tokens verde-azulado e laranja');
 assert.doesNotMatch(ler('cfo.css'),/body\.dark [^{]*(delta-ruim|mini-serie\.sobe)[^{]*\{[^}]*#f0708f/,'no escuro o Δ ruim usa var(--red)');
});
test('o tom vence no próprio componente, nunca por !important nas classes de tom',()=>{
 assert.doesNotMatch(css,/\.tom-(entra|sai)\{[^}]*!important/);
 const c=ler('compacto.css');
 assert.match(c,/\.tabela-controle \.num\.tom-entra\{color:var\(--blue\)\}\.tabela-controle \.num\.tom-sai\{color:var\(--red\)\}/,'Preço e tabelas de controle');
 assert.match(c,/\.ind-metrics \.ind-metric strong\.tom-sai\{color:var\(--red\)\}\.ind-metrics \.ind-metric strong\.tom-entra\{color:var\(--blue\)\}/,'cartões dos Indicadores');
 assert.ok(c.indexOf('.ind-metrics .ind-metric strong.tom-sai')>c.indexOf('.ind-metrics .ind-metric:not(:first-child) strong{'),'mesma especificidade: vem depois');
 assert.doesNotMatch(bloco(c,'.cost-shortcut strong'),/color/,'atalho de despesa sem vermelho fixo');
 assert.match(ler('cfo.css'),/td\.num>\.cfo-link,\.line>b>\.cfo-link\{color:inherit\}/,'valor dentro do link herda o tom da célula');
 assert.match(ler('cfo.css'),/\.cfo-cauda td\.num\.tom-sai\{color:var\(--red\)\}/);
 assert.match(ler('styles.css'),/\.cost-comparison b\.delta-ruim\{color:var\(--red\)\}/);
 assert.match(c,/\.dre-compact \.dre-row-ratio th\{color:var\(--blue\)\}/,'Δ p.p. da margem não herda o azul da linha');
 assert.doesNotMatch(bloco(ler('indicadores.css'),'.ind-metric strong'),/ind-blue/,'primeiro cartão sem tom fica na cor do texto');
});
test('status usa verde e âmbar, nunca as cores do dinheiro',()=>{
 assert.match(css,/\.fech-lista \.st-ok b,b\.st-ok,strong\.st-ok,\.cards-controle \.metric-param strong\.st-ok\{color:var\(--green\)\}/);
 assert.match(css,/\.fech-lista \.st-atencao b\{color:var\(--amber\)\}/);
 const ind=ler('indicadores.css');
 assert.match(bloco(ind,'.ind-q-ok'),/var\(--green\)/);assert.doesNotMatch(bloco(ind,'.ind-q-ok'),/--blue|--fam-entrada/);
 assert.match(bloco(ind,'.ind-tag.warn'),/color:var\(--amber\)/);
 assert.match(ind,/\.ind-fill-ok\{fill:var\(--cob-ok\)\}/);
 assert.doesNotMatch(ind,/(^|[}\n])\.ind-fill-(entrada|saida|aviso|neutro)\{fill:#/,'barras dos Indicadores seguem o tema (a impressão fica fixa)');
});
test('no escuro os gráficos usam o mesmo azul e vermelho do resto do app',()=>{
 const escuro=ler('graficos.css').match(/body\.dark\{([\s\S]*?)\n\}/)[1],app=ler('styles.css').match(/body\.dark\{--chart-in:(#[0-9a-f]+);--chart-out:(#[0-9a-f]+)/);
 assert.ok(app,'--chart-in/--chart-out do escuro');
 assert.match(escuro,new RegExp('--g-entrada:'+app[1]+';--g-saida:'+app[2]+';'));assert.match(escuro,new RegExp('--g-marca:'+app[1]+';'));
 assert.doesNotMatch(ler('graficos.css').match(/:root\{([\s\S]*?)\n\}/)[1],/var\(--chart/,'apelido no :root congelaria o tema claro');
});
test('celular: tabela não estoura a tela, rótulo de linha sem caixa alta e alvos de 44px',()=>{
 const s=ler('styles.css');
 assert.match(s,/\.table-scroll\{position:relative;overflow:auto/,'o .sr-only do Parâmetros fica preso no contêiner');
 assert.match(s,/tbody th\{text-transform:none;letter-spacing:0;color:var\(--text\);background:none\}/);
 const c=ler('compacto.css');
 assert.match(c,/\.month-chips\{order:3;flex-basis:100%;display:flex;flex-wrap:nowrap;overflow-x:auto/,'meses numa linha só');
 assert.doesNotMatch(c,/min-height:40px\}\.period-compare\{margin-left:auto\}\.period #yearSelect\{min-height:40px\}/);
 assert.match(c,/\.table-scroll caption\{caption-side:top;text-align:left[^}]*position:sticky;left:0;width:100cqi/,'legenda parada no canto');
 assert.match(c,/#appShell>\.sidebar \.menu-toggle\{position:absolute/,'Menu na linha do topo');
 assert.doesNotMatch(bloco(ler('indicadores.css'),'@media(max-width:650px){.ind-nav'),/nowrap/,'as seis áreas quebram linha');
});
test('menu: Parâmetros com ícone próprio, Configurações e Ajuda marcam a tela e o diálogo tem nome',()=>{
 const h=ler('index.html'),ic=id=>h.match(new RegExp(id+'"?>\\s*<span class="ic" aria-hidden="true">([^<]+)<'))?.[1];
 assert.ok(ic('data-view="parametros')&&ic('data-view="parametros')!==ic('id="settingsBtn" data-view="config'),'ícones diferentes');
 assert.match(h,/<button id="settingsBtn" data-view="config">/);assert.match(h,/<button id="helpBtn" data-view="ajuda">/);
 assert.match(h,/<dialog id="detailDialog" aria-labelledby="detailTitle">/);
});
