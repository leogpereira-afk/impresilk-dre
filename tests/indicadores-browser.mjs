// Verificação isolada: dados sintéticos interceptados no navegador, sem escrita remota.
import {chromium} from '/Users/leonardopereira/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {normalizarSnapshot,resumir} from '../indicadores-modelo.mjs';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const reg={id:'Set_2026',label:'Set/2026',company:'Impresilk + Universo',basis:'Caixa gerencial',origem:'erp',atualizadoEm:'2026-10-08T12:00:00Z',qualidade:{de:'2026-09-01',ate:'2026-09-30',coletadoEm:'2026-10-08T12:00:00Z',apiContratoValidado:true,conciliado:false,estado:'aguardando-conferencia'},cells:[{code:'1',name:'Entradas',value:6000},{code:'2',name:'Saídas',value:1200}],eventos:Array.from({length:60},(_,i)=>({natureza:'entrada',empresa:'Impresilk',tituloId:String(i),pagamentoId:String(i),data:'2026-09-05',valor:100,nomeConta:i<40?'Serviços de impressão':'Instalação'})).concat([{natureza:'saida',empresa:'Universo',tituloId:'pag',pagamentoId:'p',data:'2026-09-03',valor:1200,nomeConta:'Conta para conferência'}])};
let fail=false;
await page.route('https://heveemylixartyijxewh.supabase.co/**',async route=>{
 let b={};try{b=route.request().postDataJSON()||{};}catch{}let r={ok:true};
 if(b.acao==='eu')r={ok:true};
 if(b.action==='permissions')r={ok:true,permissoes:{leitura:true,edicao:false,admin:false}};
 if(b.action==='list')r={ok:true,itens:[reg],nextOffset:null};
 if(b.action==='getCfg')r={ok:true,cfg:{},atualizadoEm:null};
 if(b.action==='coletaStatus')r={ok:true,coleta:{estado:'concluida'}};
 if(b.action==='indicadores'){
  if(fail){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({erro:'Falha de leitura simulada'})});return;}
  const s={desde:'2026-09-01',ate:'2026-09-30',completo:true,em:'2026-10-01T12:00:00Z',itens:[{id:'teste-1',numero:'OS TESTE',cliente:'Cliente demonstrativo',venda:100000,custo:60000,tipo:'Normal',previstos:[{nome:'Impressão',tempo:30}],realizados:[{nome:'Impressão',tempo:0}]}]};
  const base=normalizarSnapshot(s,b.fonte,{de:b.de,ate:b.ate});r={ok:true,...base,...resumir(base.rows,{...b,tamanho:b.exportar?5000:50})};
 }
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(r)});
});
await page.addInitScript(()=>localStorage.setItem('impresilk_dre_cracha','fixture.'+btoa(JSON.stringify({sub:'teste'}))+'.fixture'));
try{
 await page.goto('http://127.0.0.1:8793/');await page.locator('#appShell').waitFor({state:'visible'});
 await page.locator('[data-view="indicadores"]').click();await page.locator('#monthSelect').selectOption('Set/2026');
 await page.getByRole('button',{name:'Receita',exact:true}).waitFor();assert.match(await page.locator('.ind-metrics').innerText(),/6\.000,00/);
 await page.screenshot({path:'entregas/revisao/indicadores-desktop.png',fullPage:true});
 for(const area of ['Custos','Despesas','Resultado','Margem','Rentabilidade','Receita']){await page.getByRole('navigation',{name:'Áreas dos indicadores'}).getByRole('button',{name:area,exact:true}).click();await page.waitForTimeout(70);assert.equal(await page.locator('.ind-heading h2').innerText(),area);}
 await page.locator('.ind-composition summary').click();await page.locator('[data-group="Serviços de impressão"]').click();assert.match(await page.locator('.ind-metrics').innerText(),/4\.000,00/);assert.match(await page.locator('.ind-table').innerText(),/Serviços de impressão/);
 const dlP=page.waitForEvent('download');await page.locator('[data-export]').click();const dl=await dlP;await dl.saveAs('entregas/revisao/indicadores-filtro.csv');const csv=await fs.readFile('entregas/revisao/indicadores-filtro.csv','utf8');assert.match(csv,/4000,00/);assert.match(csv,/Serviços de impressão/);
 await page.locator('[data-clear]').click();await page.locator('[data-page="1"]').click();assert.equal(await page.locator('.ind-table tbody tr').count(),10);
 await page.locator('[data-row="0"]').click();await page.locator('#detailDialog').waitFor({state:'visible'});assert.match(await page.locator('#detailContent').innerText(),/pagamento/);await page.locator('#detailClose').click();
 await page.evaluate(()=>window.print=()=>{window.__printed=true});await page.locator('[data-pdf]').click();assert.equal(await page.locator('#indPrint tbody tr').count(),60);await page.emulateMedia({media:'print'});await page.pdf({path:'entregas/revisao/indicadores-teste.pdf',format:'A4',printBackground:true});await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 await page.getByRole('button',{name:'Custos',exact:true}).click();await page.locator('.ind-metric strong').first().waitFor();assert.match(await page.locator('.ind-metrics').innerText(),/600,00/);await page.locator('[data-row="0"]').click();assert.match(await page.locator('#detailContent').innerText(),/Apontamentos registrados/);await page.locator('#detailClose').click();
 fail=true;await page.locator('[data-refresh]').click();await page.locator('.ind-error').waitFor();assert.match(await page.locator('.ind-error').innerText(),/última leitura/);assert.match(await page.locator('.ind-metrics').innerText(),/600,00/);
 fail=false;await page.getByRole('button',{name:'Margem',exact:true}).click();await page.locator('[name=excecao]').selectOption('custo-maior');await page.getByRole('button',{name:'Aplicar',exact:true}).click();await page.getByText('Nenhum registro encontrado nesse filtro.',{exact:false}).waitFor();await page.locator('[name=excecao]').selectOption('todas');await page.getByRole('button',{name:'Aplicar',exact:true}).click();await page.getByText('OS TESTE',{exact:true}).waitFor();await page.getByRole('button',{name:'Receita',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'entregas/revisao/indicadores-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Sem rolagem horizontal na página');
 await page.locator('[data-formula]').first().focus();await page.keyboard.press('Enter');await page.locator('#detailDialog').waitFor({state:'visible'});await page.keyboard.press('Escape');
 await page.reload();await page.locator('[data-view="indicadores"]').click();await page.locator('#monthSelect').selectOption('Set/2026');assert.match(await page.locator('.ind-metrics').innerText(),/6\.000,00/);
 assert.deepEqual(errors,[]);console.log('Browser OK: 6 áreas, filtros, paginação, detalhes, CSV, PDF, falha preservando leitura, teclado, recarga e celular 390px.');
}finally{await browser.close();}
