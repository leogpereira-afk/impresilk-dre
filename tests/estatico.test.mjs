// Conferências estáticas da v135 (auditoria v133, seção 3): versão única entre página, imports e cache; tokens num bloco só;
// nenhuma classe CSS sem uso; fonte mínima de 11px no texto HTML; nenhum travessão em frase visível.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {test} from 'node:test';
const RAIZ=new URL('../',import.meta.url).pathname;
const ler=f=>fs.readFileSync(path.join(RAIZ,f),'utf8');
const CSS=['styles.css','compacto.css','cfo.css','graficos.css','indicadores.css'];
const daRaiz=re=>fs.readdirSync(RAIZ).filter(f=>re.test(f)&&fs.statSync(path.join(RAIZ,f)).isFile()).sort();
const arvore=d=>fs.readdirSync(path.join(RAIZ,d),{withFileTypes:true}).flatMap(e=>e.isDirectory()?arvore(path.join(d,e.name)):[path.join(d,e.name)]);
// Comentário de bloco vira linhas em branco: o número da linha continua o do arquivo.
const semComentario=t=>t.replace(/\/\*[\s\S]*?\*\//g,c=>c.replace(/[^\n]/g,''));
// Regras do CSS com o @media em volta: [{sel,corpo,pais:[preâmbulos]}], só as que têm declarações.
function regras(txt){
 const s=semComentario(txt),out=[],pilha=[];let ini=0;
 for(let i=0;i<s.length;i++){
  if(s[i]==='{'){pilha.push({pre:s.slice(ini,i).trim(),ab:i});ini=i+1;}
  else if(s[i]==='}'){const b=pilha.pop();if(!b)continue;const corpo=s.slice(b.ab+1,i);if(!corpo.includes('{')&&!b.pre.startsWith('@'))out.push({sel:b.pre,corpo,pais:pilha.map(p=>p.pre)});ini=i+1;}
  else if(s[i]===';'&&!pilha.length)ini=i+1;
 }
 return out;
}

test('?v= igual ao CACHE: página, imports e cache offline na mesma versão',()=>{
 const v=ler('sw.js').match(/const CACHE = 'dre-shell-v(\d+)'/)?.[1];assert.ok(v,'CACHE do sw.js');
 const achadas=[...ler('index.html').matchAll(/\?v=(\d+)/g)].map(m=>['index.html',m[1]]);
 for(const f of daRaiz(/\.m?js$/))if(f!=='sw.js')for(const m of ler(f).matchAll(/\.m?js\?v=(\d+)/g))achadas.push([f,m[1]]);
 assert.ok(achadas.some(([f])=>f==='indicadores.js'),'o import do modelo dos Indicadores leva ?v=');
 const erradas=achadas.filter(([,x])=>x!==v).map(([f,x])=>`${f}: ?v=${x}`);
 assert.deepEqual(erradas,[],`versão ${v} no sw.js`);
});

test('tokens declarados uma vez: :root e body.dark de topo sem propriedade repetida entre blocos',()=>{
 const vistos={':root':new Map(),'body.dark':new Map()},rep=[];
 for(const f of CSS)for(const [n,r] of regras(ler(f)).entries()){
  if(r.pais.length||!(r.sel in vistos))continue;
  const props=new Set([...r.corpo.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]));
  for(const p of props){const onde=`${f} (bloco ${n+1})`,ja=vistos[r.sel].get(p);if(ja)rep.push(`${r.sel} ${p}: ${ja} e ${onde}`);else vistos[r.sel].set(p,onde);}
 }
 assert.deepEqual(rep,[],'cada token num bloco só');
 for(const f of ['compacto.css','cfo.css','indicadores.css'])assert.doesNotMatch(semComentario(ler(f)),/(^|[}\s]):root\s*\{/,f+' sem :root próprio');
});

test('classe CSS sem uso: toda classe dos seletores aparece no JS, no HTML, nos scripts ou nos testes',()=>{
 // Montadas por prefixo no JS (ex.: `sit-${x}`). Classe nova montada com ${…} entra nesta lista.
 const PREFIXOS=['aval-','cmp-tinta-','dre-row-','dre-l-','ind-fill-','ind-q-','sit-','water-','g-cmp-','g-cor-','g-faixa-','nivel-','origem-','metric-'];
 const classes=new Map();
 for(const f of CSS)for(const r of regras(ler(f)))for(const m of r.sel.replace(/\[[^\]]*\]/g,'').matchAll(/\.(-?[a-zA-Z_][\w-]*)/g))if(!classes.has(m[1]))classes.set(m[1],f);
 const fontes=[...daRaiz(/\.(m?js|html)$/),...arvore('scripts'),...arvore('tests').filter(f=>!f.endsWith('estatico.test.mjs'))];
 const corpus=fontes.map(f=>fs.readFileSync(path.join(RAIZ,f),'utf8')).join('\n');
 const usada=c=>new RegExp(`(^|[^\\w-])${c.replace(/[-]/g,'\\-')}(?![\\w-])`).test(corpus);
 const sobram=[...classes].filter(([c])=>!PREFIXOS.some(p=>c.startsWith(p))&&!usada(c)).map(([c,f])=>`${f}: .${c}`);
 assert.deepEqual(sobram,[],'apague a regra ou use a classe');
});

test('fonte mínima: nada de 9 ou 10px no texto HTML (SVG do viewBox e impressão ficam de fora)',()=>{
 const SVG=['.ritmo-eixo','.ritmo-mes','.linhas-eixo','.linhas-mes','.ind-axis'];
 const doSvg=sel=>sel.split(',').every(p=>SVG.some(c=>new RegExp(c.replace('.','\\.')+'(?![\\w-])').test(p)));
 const ruins=[];
 for(const f of CSS)for(const r of regras(ler(f))){
  if(!/font-size\s*:\s*(9|10)(\.\d+)?px/.test(r.corpo)||doSvg(r.sel)||r.pais.some(p=>/@media\s*print/i.test(p)))continue;
  ruins.push(`${f}: ${r.sel.replace(/\s+/g,' ').slice(0,90)}`);
 }
 assert.deepEqual(ruins,[],'use var(--fs-xs) (11px)');
});

test('sem travessão em texto visível: "—" só sozinho, em "— = …" ou "— significa"',()=>{
 const achados=[];
 for(const f of [...daRaiz(/\.m?js$/),'index.html']){
  let t=semComentario(ler(f));if(f.endsWith('.html'))t=t.replace(/<!--[\s\S]*?-->/g,c=>c.replace(/[^\n]/g,''));
  t.split('\n').forEach((l,i)=>{if(/^\s*\/\//.test(l))return;const m=l.match(/(?:\S\s|['"`(>])—\s(?!=\s|significa)\S/);if(m)achados.push(`${f}:${i+1}: …${l.slice(Math.max(0,m.index-30),m.index+40).trim()}…`);});
 }
 assert.deepEqual(achados,[],'troque o travessão por ":", ";" ou ponto');
});

test('CI: portão visual num job à parte, depois do build, sem segurar a publicação',()=>{
 const y=ler('.github/workflows/pages.yml'),jobs={};let atual=null;
 for(const l of y.slice(y.indexOf('\njobs:')).split('\n').slice(2)){const m=l.match(/^  ([\w-]+):\s*$/);if(m)jobs[atual=m[1]]=[];else if(atual)jobs[atual].push(l);}
 assert.deepEqual(Object.keys(jobs),['build','portao-visual','deploy']);
 const needs=j=>jobs[j].join('\n').match(/^    needs:\s*(.+)$/m)?.[1].trim();
 assert.equal(needs('deploy'),'build','o deploy depende só do build');assert.equal(needs('portao-visual'),'build');
 const p=jobs['portao-visual'].join('\n');
 assert.match(p,/npm i --no-save --no-package-lock playwright@1\.62\.1/);assert.match(p,/npx playwright install --with-deps chromium/);
 assert.match(p,/python3 -m http\.server 8793 --bind 127\.0\.0\.1 > \/tmp\/servidor\.log 2>&1 &/);
 assert.match(p,/DRE_URL: http:\/\/127\.0\.0\.1:8793\//);assert.match(p,/node tests\/visual\/regra-cores\.mjs --json portao\.json/);
 assert.match(p,/- if: always\(\)\n\s+uses: actions\/upload-artifact@v4[\s\S]*path: portao\.json/);
 assert.doesNotMatch(p,/continue-on-error/,'falha do portão fica vermelha no Actions');
 // o job instala código de terceiros: só lê o repositório, sem herdar pages: write e id-token: write do workflow
 assert.match(p,/\n    permissions:\n      contents: read\n    steps:/,'portão com permissão só de leitura');assert.doesNotMatch(p,/pages:|id-token:/);
 const r=ler('tests/visual/regra-cores.mjs'),b=ler('tests/visual/base.mjs');
 assert.ok(r.indexOf('await esperarServidor()')>=0&&r.indexOf('await esperarServidor()')<r.indexOf('await lancar()'),'espera o servidor antes de abrir');
 assert.match(b,/export async function esperarServidor\(limite = 10000\)/);
 assert.match(b,/await import\(process\.env\.PLAYWRIGHT \|\| 'playwright'\)/);assert.match(b,/CHROME \? \{executablePath: CHROME\} : \{\}/);
 assert.match(r,/'id-duplicado'/);assert.match(r,/'controle-sem-nome'/);assert.match(r,/const SO_AVISO = new Set\(\['id-duplicado', 'controle-sem-nome'\]\)/,'acessibilidade ainda não reprova');
});

test('o leitor de CSS separa regra, @media e comentário',()=>{
 const r=regras('/* .x{} */:root{--a:1}@media print{.b{font-size:9px}}@media(max-width:650px){.c,.d{color:red}}');
 assert.deepEqual(r.map(x=>[x.sel,x.pais]),[[':root',[]],['.b',['@media print']],['.c,.d',['@media(max-width:650px)']]]);
});

// Anos futuros (pedido do dono: "ele alimenta os próximos anos quando ele vier"): as listas de anos e as regras
// do Ano saem dos dados e do relógio do app (hojeRotulo/anoDeHoje, que passam por dfcHoje), nunca de um ano escrito.
const SEM_ANO_NO_CODIGO=['periodoOptions','anosComparaveis','anoPadraoComparado','anoComparado','mesesComparaveisAno','registroDoAno','comparacaoDoAno','rotuloAno','rotuloMesesAno','anoDeHoje','selecionarAnoComparado','fimDoAno'];
// Corpo de "function nome(" ou de "const nome=" (arrow com chaves ou de uma linha), sem os comentários.
function corpoDe(txt,nome){
 const m=txt.match(new RegExp(`(?:^|\\n)\\s*(?:function\\s+${nome}\\s*\\(|(?:const|let|var)\\s+${nome}\\s*=)`));if(!m)return null;
 const ini=m.index+m[0].length;let i=ini;
 if(/function/.test(m[0])){let p=1;for(;i<txt.length&&p;i++){if(txt[i]==='(')p++;else if(txt[i]===')')p--;}}
 else{const seta=txt.indexOf('=>',ini),fimLinha=txt.indexOf('\n',ini);if(seta<0||(fimLinha>=0&&seta>fimLinha))return txt.slice(ini,fimLinha<0?undefined:fimLinha);i=seta+2;while(/\s/.test(txt[i]))i++;if(txt[i]!=='{'){const f=txt.indexOf('\n',i);return txt.slice(ini,f<0?undefined:f);}}
 const a=txt.indexOf('{',i);if(a<0)return null;let d=0;
 for(let j=a;j<txt.length;j++){if(txt[j]==='{')d++;else if(txt[j]==='}'&&--d===0)return txt.slice(ini,j+1);}
 return null;
}
const semComentarioJS=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"`\\])\/\/[^\n]*/g,'$1');
function anoNoCodigo(txt){
 const achados=[];
 for(const nome of SEM_ANO_NO_CODIGO){
  const c=corpoDe(txt,nome);if(c==null){achados.push(`${nome}: não encontrada no app.js`);continue;}
  const corpo=semComentarioJS(c),ano=corpo.match(/\b(19|20)\d\d\b/);if(ano)achados.push(`${nome}: ano escrito (${ano[0]})`);
  if(nome==='periodoOptions')for(const relogio of ['new Date(','mesHoje('])if(corpo.includes(relogio))achados.push(`periodoOptions: relógio direto (${relogio})`);
 }
 return achados;
}
test('anos futuros: nenhuma função das listas de anos e do Ano tem ano escrito; o seletor de ano não lê o relógio direto',()=>{
 assert.deepEqual(anoNoCodigo(ler('app.js')),[],'use anoDeHoje()/hojeRotulo() e os rótulos dos registros');
});
test('o leitor de funções acha o corpo e pega ano escrito ou relógio direto',()=>{
 const base=['function periodoOptions(){const y=anoDeHoje();if(a){b()}return y;}',...SEM_ANO_NO_CODIGO.filter(n=>n!=='periodoOptions'&&n!=='anoDeHoje').map(n=>`function ${n}(a=x()){return {a}; // 2026 só no comentário\n}`),'const anoDeHoje=()=>Number(hojeRotulo().split(\'/\')[1]);'].join('\n');
 assert.deepEqual(anoNoCodigo(base),[],'comentário com ano não conta');
 assert.equal(corpoDe(base,'periodoOptions'),'){const y=anoDeHoje();if(a){b()}return y;}');
 assert.deepEqual(anoNoCodigo(base.replaceAll('return {a};','return a>2026?1:{a};').replace('const y=anoDeHoje()','const y=new Date().getFullYear(),m=mesHoje()')).sort(),['periodoOptions: relógio direto (mesHoje()','periodoOptions: relógio direto (new Date()',...SEM_ANO_NO_CODIGO.filter(n=>n!=='periodoOptions'&&n!=='anoDeHoje').map(n=>`${n}: ano escrito (2026)`)].sort());
 assert.deepEqual(anoNoCodigo(base.replace("split('/')[1]","split('/')[1]||2027")),['anoDeHoje: ano escrito (2027)'],'arrow de uma linha');
});
