// Auditoria v135, frente css: tokens num bloco só, fonte mínima, CSS morto fora, marcas do HTML
// que as outras frentes ligam (pular conteúdo, topo e menu, logo para o Dashboard) e o cache do PWA.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ARQ=['styles.css','compacto.css','cfo.css','graficos.css','indicadores.css'];
const semComentario=t=>t.replace(/\/\*[\s\S]*?\*\//g,'');
const css=ARQ.map(f=>semComentario(ler(f))).join('\n');
// blocos de nível de topo (fora de @media) com o seletor exato
const blocosTopo=(txt,sel)=>{const out=[];let prof=0,ini=0;txt=semComentario(txt);
 for(let i=0;i<txt.length;i++){const c=txt[i];if(c==='{'){if(prof===0&&txt.slice(ini,i).trim()===sel){const f=txt.indexOf('}',i);out.push(txt.slice(i+1,f));}prof++;}else if(c==='}'){prof--;if(prof===0)ini=i+1;}}
 return out;};

test('tokens: um bloco só no :root da linha 3 e body.dark começando pelas cores dos gráficos',()=>{
 const s=ler('styles.css'),l3=s.split('\n')[2];
 assert.match(l3,/^:root\{--blue:#284ac7;[^}]*--bg:#f5f7fb;/,'--bg que vale hoje');
 for(const t of ['--chart-in:#2f62d0','--chart-out:#c7424c','--chart-cost:#c7424c','--chart-net:#5b6a86','--cob-ok:#238a7b','--fs-xs:11px','--fs-sm:12px','--fs-md:13px','--fs-base:14px','--fs-lg:16px','--fs-xl:20px'])assert.ok(l3.slice(0,l3.indexOf('}')).includes(t),t);
 assert.match(l3,/body\.dark\{--chart-in:#8fb0ff;--chart-out:#ff8f8c;--chart-cost:#ff8f8c;--chart-net:#b3bdd0;--cob-ok:#58c5b1;--text:/);
 for(const f of ['compacto.css','cfo.css','indicadores.css'])assert.doesNotMatch(semComentario(ler(f)),/(^|[}\s]):root\{/,f+' sem :root');
 for(const sel of [':root','body.dark']){
  const vistos=new Map();
  for(const f of ARQ)for(const b of blocosTopo(ler(f),sel))for(const m of b.matchAll(/(--[\w-]+)\s*:/g)){assert.ok(!vistos.has(m[1]),`${m[1]} declarado de novo em ${sel} (${vistos.get(m[1])} e ${f})`);vistos.set(m[1],f);}
 }
});
test('fonte mínima: nenhum texto HTML abaixo de 11px (os textos de SVG em unidades do viewBox ficam)',()=>{
 assert.doesNotMatch(css,/font-size:(9|10)(\.\d+)?px/);
 const svg=[...css.matchAll(/([^{}]+)\{[^}]*font:(9|10)(\.\d+)?px/g)].map(m=>m[1].trim());
 for(const s of svg)assert.match(s,/^\.(ritmo-eixo|ritmo-mes|linhas-eixo|linhas-mes|ind-axis)$/,s);
 assert.match(ler('compacto.css'),/\.chart-column\{font-size:var\(--fs-xs\)\}/);
 assert.match(ler('styles.css'),/\nsmall\{font-size:max\(var\(--fs-xs\),\.833em\)\}/,'<small> sem tamanho próprio (padrão "smaller") não desce de 11px');
});
test('avisos e erros pelos tokens do tema, sem cor fixa clara',()=>{
 assert.doesNotMatch(css,/amber-soft|#f59e0b|#c27913|#ca934b|#fff0f1/i);
 assert.match(ler('indicadores.css'),/\.ind-error\{background:color-mix\(in srgb,var\(--red\) 10%,var\(--surface\)\);border:1px solid color-mix\(in srgb,var\(--red\) 35%,var\(--surface\)\);color:var\(--red\)/);
 assert.match(ler('styles.css'),/\.coleta-alerta\{border-color:var\(--amber\)\}/);
 assert.match(ler('cfo.css'),/\.cfo-pendencias:hover\{border-color:var\(--amber\)\}/);
});
test('dica do gráfico pinta o valor com o tom e contraste nos dois temas',()=>{
 const s=ler('styles.css');
 assert.match(s,/\.chart-tooltip strong\.tom-entra\{color:#8fb0ff\}\.chart-tooltip strong\.tom-sai\{color:#ff8f8c\}body\.dark \.chart-tooltip strong\.tom-entra\{color:#284ac7\}body\.dark \.chart-tooltip strong\.tom-sai\{color:#a2353a\}/);
 const lum=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 const contraste=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
 // fundo da dica = --text do tema (#28344c no claro, #e5ebf8 no escuro)
 for(const [cor,fundo] of [['#8fb0ff','#28344c'],['#ff8f8c','#28344c'],['#284ac7','#e5ebf8'],['#a2353a','#e5ebf8']])assert.ok(contraste(cor,fundo)>=4.5,`${cor} sobre ${fundo}: ${contraste(cor,fundo).toFixed(2)}`);
});
test('um marcador de abrir e fechar: ＋/− no Glossário e ▸/▾ no "Ver os valores"',()=>{
 assert.doesNotMatch(css,/rotate\(45deg\)/);
 assert.match(ler('styles.css'),/\.glossary-marca::after\{content:'＋';font-size:21px\}\.glossary-item\[open\] \.glossary-marca::after\{content:'−'\}/);
 assert.match(ler('graficos.css'),/\.g-tabela>summary::before\{content:'▸';margin-right:6px\}\.g-tabela\[open\]>summary::before\{content:'▾'\}/);
});
test('CSS morto fora; classes vivas e montadas por prefixo ficam',()=>{
 for(const morto of ['.tag{','.pos{','.bar-item','.metric-neg','.chart-frame','.expense-card','.ind-context','.ind-filter-context','.plano-pagination','.source-periods','.painel-escuro','.cascata-svg','.blocos-svg','.casc-','.pt-variacao','.pt-var','.g-rot-dentro.g-claro','.g-rot-dentro.g-escuro'])assert.ok(!css.includes(morto),morto);
 for(const vivo of ['.nowrap{','.cobertura-faixa','.cob.validado i','.bars{','.plano-viewbar #exportAccounts','.linhas-eixo','.ind-comparison-limit'])assert.ok(css.includes(vivo),vivo);
});
test('regras novas que as outras frentes consomem pelo nome da classe',()=>{
 const c=ler('compacto.css'),ind=ler('indicadores.css');
 assert.match(c,/\.month-chips button\.apurado\{position:relative\}\.month-chips button\.apurado::after\{content:'✓';position:absolute;top:2px;right:3px;/,'✓ sem mudar a largura do chip');
 assert.match(c,/\.tabela-controle td\.num\.giro-vencido\{color:var\(--amber\);font-weight:650\}/);
 assert.match(c,/\.context-nav\.veja-tambem\{margin:24px 0 8px;gap:4px 14px;font-size:13px\}\.context-nav\.veja-tambem button\{border:0;border-radius:0;background:none;padding:0;min-height:44px;font-size:13px;color:var\(--blue\)\}/);
 assert.match(c,/\.voltar-menu\{display:none\}\n@media\(max-width:900px\)\{\.voltar-menu\{display:flex;align-items:center;min-height:44px;margin:12px auto 20px\}\}/);
 assert.match(ind,/\.indicadores \.ind-metrics \.ind-metric strong\.ind-vazio[,{][^}]*\{color:var\(--muted\);font-size:14px;font-weight:600\}/);
 assert.match(ler('styles.css'),/\.pular-conteudo\{position:fixed;left:8px;top:-80px;z-index:60\}\.pular-conteudo:focus\{top:8px\}/);
 assert.match(ler('styles.css'),/\.card>summary>\.card-titulo\{font:inherit;color:inherit;margin:0;display:inline\}/);
});
test('tabelas e grades: coluna do mês parada, colunas iguais nos Comparativos e sem trilha vazia',()=>{
 const c=ler('compacto.css');
 assert.match(c,/\.precos-tabela thead th:first-child,\.precos-tabela tbody th,\.giro-historico thead th:first-child,\.giro-historico tbody th\{position:sticky;left:0;z-index:1;background:var\(--surface\);min-width:90px;box-shadow:1px 0 var\(--line\)\}/);
 assert.match(c,/\.precos-tabela tbody th\{white-space:nowrap\}\.precos-tabela th,\.precos-tabela td\{padding:8px 6px\}\.precos-tabela thead th\{white-space:normal;vertical-align:bottom\}/,'cabeçalho quebra linha: a 1440 a tabela cabe sem rolar');
 assert.match(c,/@media\(min-width:701px\)\{\.cmp-tabela\{table-layout:fixed;width:100%\}\.cmp-tabela tbody th,\.cmp-tabela thead th:first-child\{width:55%;min-width:0\}\}/);
 assert.match(c,/\.graficos-controle:has\(>\.dre-grafico-largo\)\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
 assert.match(c,/\.chart-card svg\.linhas-chart\{max-height:340px\}/);
 assert.match(ler('indicadores.css'),/\.indicadores \.ind-analysis>\.ind-chart-months\+\.ind-composition:last-child\{grid-column:1\/-1\}/);
 assert.doesNotMatch(ler('indicadores.css'),/\.ind-table\{max-height|\.ind-panel>\.ind-table\{[^}]*max-height/,'tabela dos Indicadores sem rolagem interna');
 assert.match(ler('cfo.css'),/\.waterfall-scroll,\.g-tabela\[open\]\{/);assert.match(ler('cfo.css'),/body\.dark \.waterfall-scroll,body\.dark \.g-tabela\[open\]\{/);
 assert.match(ler('graficos.css'),/\.g-tabela\[open\]\{overflow-x:auto\}/);
 assert.match(c,/\.param-form \.form-grid>label\{display:flex;flex-direction:column;justify-content:flex-end\}/);assert.match(c,/>input:not\(\[type=checkbox\]\),\.param-form \.form-grid>label>select\{min-height:46px\}/);assert.doesNotMatch(c,/>select\{margin-top:auto\}/);
 assert.match(c,/#pageContent p\.hint,#pageContent p\.note\{max-width:90ch\}/);
});
test('nome de conta clicável com um estilo só: cor do texto e sublinhado tracejado',()=>{
 assert.match(ler('cfo.css'),/\.cfo-link,\.cfo-value\{[^}]*border-bottom:1px dashed var\(--line\);[^}]*color:var\(--text\);/);
 const c=ler('compacto.css');
 assert.match(c,/\.dre-composicao-tabela th button\{border:0;border-bottom:1px dashed var\(--line\);border-radius:0;background:none;padding:0;color:var\(--text\)/);
 assert.match(c,/\.source-grid table th button\{border:0;border-bottom:1px dashed var\(--line\);[^}]*color:var\(--text\)/);
 assert.match(c,/\.cfo-link:hover,\.dre-composicao-tabela th button:hover,\.source-grid table th button:hover\{border-bottom-color:var\(--blue\);background:var\(--selected\)\}/);
});
test('index.html: pular para o conteúdo, topo e menu, logo leva ao Dashboard e logo em WebP',()=>{
 const h=ler('index.html');
 assert.match(h,/<div id="appShell" hidden><button type="button" id="pularConteudo" class="pular-conteudo">Pular para o conteúdo<\/button><aside/);
 assert.match(h,/<footer id="footMeta"><\/footer><button type="button" id="voltarMenu" class="voltar-menu">↑ Topo e menu<\/button>/);
 assert.match(h,/<a href="#tela=inicio" class="brand" aria-label="Impresilk Financeiro: ir ao Dashboard"><img src="logo\.webp" alt="Impresilk">/);
 assert.match(h,/<h1 id="pageTitle" tabindex="-1">/);
 assert.equal((h.match(/src="logo\.webp"/g)||[]).length,2);assert.doesNotMatch(h,/logo\.png/);
 const w=fs.readFileSync(new URL('../logo.webp',import.meta.url));
 assert.equal(w.toString('latin1',0,4)+w.toString('latin1',8,16),'RIFFWEBPVP8X');
 assert.deepEqual([w.readUIntLE(24,3)+1,w.readUIntLE(27,3)+1],[300,170]);
});
test('manifesto com as cores do app',()=>{
 const m=JSON.parse(ler('manifest.webmanifest'));assert.equal(m.theme_color,'#284ac7');assert.equal(m.background_color,'#f5f7fb');
});
// Service worker num contexto falso: instala, confere o que pede com cache:'reload' e o PDF offline.
function sw(){
 const ouvintes={},caches={},resp=u=>({u});
 const abrir=async n=>caches[n]??=(()=>{const m=new Map();return {m,
  addAll:async rs=>{for(const r of rs)m.set(r.url,r);},add:async u=>{m.set(u,resp(u));},match:async u=>m.get(typeof u==='string'?u:u.url),put:async(r,v)=>m.set(r.url,v),keys:async()=>[...m.keys()]};})();
 const c={self:{addEventListener:(t,f)=>ouvintes[t]=f,location:new URL('https://x.test/app/sw.js'),skipWaiting:()=>{},clients:{claim:()=>{}}},
  caches:{open:abrir,keys:async()=>Object.keys(caches),delete:async n=>delete caches[n],match:async u=>{for(const k in caches){const v=await caches[k].match(u);if(v)return v;}}},
  Request:class{constructor(u,o){this.url=u;this.cache=o?.cache;}},URL,Response:{error:()=>'erro'},Promise};
 vm.createContext(c);vm.runInContext(ler('sw.js'),c);
 return {c,ouvintes,caches};
}
test('sw.js: reload só no que muda a cada versão e o gerador de PDF num cache próprio',async()=>{
 const t=ler('sw.js');
 assert.match(t,/const CACHE = 'dre-shell-v\d+';/,'formato lido pelo build_site.py');
 assert.match(t,/const VENDOR='dre-vendor-jspdf-1',VENDOR_ARQ=\['\.\/vendor\/jspdf\.umd\.min\.js','\.\/vendor\/jspdf\.plugin\.autotable\.min\.js'\];/);
 assert.match(t,/  '\.\/logo\.webp',\n/);assert.doesNotMatch(t,/logo\.png|supabase\.co/);
 const {ouvintes,caches}=sw();let espera;ouvintes.install({waitUntil:p=>espera=p});await espera;
 const shell=[...caches[Object.keys(caches).find(n=>n.startsWith('dre-shell-v'))].m.values()];
 const recarrega=shell.filter(r=>r.cache==='reload').map(r=>r.url),padrao=shell.filter(r=>r.cache==='default').map(r=>r.url);
 assert.ok(recarrega.includes('./')&&recarrega.includes('./index.html'));assert.ok(recarrega.filter(u=>/\?v=/.test(u)).length>20);
 assert.deepEqual(padrao.sort(),['./icone-192.png','./inter-variable.woff2','./logo.webp']);
 assert.deepEqual([...caches['dre-vendor-jspdf-1'].m.keys()],['./vendor/jspdf.umd.min.js','./vendor/jspdf.plugin.autotable.min.js']);
});
test('sw.js: falha ao baixar o vendor não derruba a instalação e o activate não apaga o cache do PDF',async()=>{
 const {c,ouvintes,caches}=sw();const abrir=c.caches.open;
 c.caches.open=async n=>{const k=await abrir(n);if(n==='dre-vendor-jspdf-1')k.add=async()=>{throw new Error('offline');};return k;};
 let espera;ouvintes.install({waitUntil:p=>espera=p});await espera;
 await abrir('dre-shell-v1');let fim;ouvintes.activate({waitUntil:p=>fim=p});await fim;
 assert.ok('dre-vendor-jspdf-1' in caches);assert.ok(!('dre-shell-v1' in caches));
});
test('sw.js: offline, o PDF sai do cache do vendor e a navegação cai no index.html',async()=>{
 const {c,ouvintes}=sw();let espera;ouvintes.install({waitUntil:p=>espera=p});await espera;
 c.fetch=()=>Promise.reject(new Error('offline'));
 const pedir=async(url,mode='cors')=>{let r;ouvintes.fetch({request:{method:'GET',url:'https://x.test/app/'+url.slice(2),mode},respondWith:p=>r=p});return r;};
 // as chaves do falso são as URLs relativas do install: o pedido precisa casar pela mesma chave
 c.caches.match=async u=>{for(const n of await c.caches.keys()){const v=await(await c.caches.open(n)).match('./'+String(u.url).split('/app/')[1]);if(v)return v;}};
 assert.deepEqual(await pedir('./vendor/jspdf.umd.min.js'),{u:'./vendor/jspdf.umd.min.js'});
 assert.equal((await pedir('./tela-que-nao-existe','navigate')).url,'./index.html');
 assert.equal(await pedir('./nada.js'),'erro');
});
