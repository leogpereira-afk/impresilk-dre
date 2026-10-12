// Fase 11.3: a carteira do Mubisys (carga do Painel) semana a semana, para o planejamento
// de 13 semanas da tela Caixa. Nada ausente vira zero; semana além da carga é dita.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {test} from 'node:test';
import {semanasCarteira,consultarGiro} from '../supabase/functions/dre-sync/giro.mjs';
const ler=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const AGORA=new Date('2026-10-12T15:00:00Z'),EM='2026-10-12T14:00:00Z';// hoje em São Paulo: 12/10/2026
const d=n=>typeof n!=='number'?n:new Date(Date.parse('2026-10-12T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const rec=(valor,dias,extra={})=>({valor,vencimento:d(dias),...extra}),pag=(valor,dias,tipo='pagar')=>({valor,vencimento:d(dias),tipo,categoria:'1.01 Impressão'});

test('semanas: hoje abre a 1ª; vencido à parte; além de 13 semanas à parte; corte e sem data fora, ditos',()=>{
 const r=semanasCarteira({receber:[rec(100,0),rec(50,6),rec(70,7),rec(30,-3),rec(999,-700),rec(10,95),rec(5,null)],pagar:[pag(200,1),pag(40,-2),pag(60,13),pag(300,20,'provisao'),pag(80,'x')],receberEm:EM,pagarEm:EM,corte:'2025-01-01',agora:AGORA});
 assert.equal(r.disponivel,true);assert.equal(r.inicio,'2026-10-12');assert.equal(r.semanas.length,13);assert.equal(r.ate,d(90));
 assert.deepEqual(r.semanas.slice(0,3).map(w=>[w.de,w.ate,w.receber,w.pagar,w.previstas]),[[d(0),d(6),150,200,0],[d(7),d(13),70,60,0],[d(14),d(20),0,0,300]]);
 assert.deepEqual(r.vencidos,{receber:30,pagar:40,previstas:0});assert.deepEqual(r.depois,{receber:10,pagar:0,previstas:0});
 assert.ok(r.avisos.some(a=>/1 título\(s\) a receber vencidos antes do corte/.test(a)));assert.ok(r.avisos.some(a=>/2 título\(s\) sem vencimento válido/.test(a)));
});
test('semanas: a carga traz a pagar até 60 dias e a receber até 90 — semana além disso é incompleta; sem carga, indisponível',()=>{
 const r=semanasCarteira({receber:[],pagar:[],receberEm:EM,pagarEm:EM,agora:AGORA});
 assert.deepEqual(r.semanas.map(w=>w.completa.pagar),[1,2,3,4,5,6,7,8,9,10,11,12,13].map(i=>i<=8),'semana 9 termina em +62 dias');
 assert.equal(r.semanas.every(w=>w.completa.receber),true);
 const so=semanasCarteira({receber:[rec(10,1)],pagar:null,receberEm:EM,agora:AGORA});assert.equal(so.semanas[0].completa.pagar,false);assert.ok(so.avisos.includes('Sem a carga do a pagar: as saídas ficam de fora.'));
 assert.equal(semanasCarteira({receber:null,pagar:null,agora:AGORA}).disponivel,false);
});
test('servidor: o capital de giro devolve as semanas, com a lista inteira do a receber (não cortada em 60 dias)',async()=>{
 const linha=(valor,atualizado_em=EM)=>({data:{valor,atualizado_em},error:null});
 const sb={from(t){const f={};const api={select(){return api;},eq(k,v){f[k]=v;return api;},order(){return Promise.resolve({data:[],error:null});},maybeSingle(){if(t==='painel_config_global')return Promise.resolve({data:{corte:'2025-01-01'},error:null});return Promise.resolve(f.chave==='recebiveis'?linha([rec(100,1,{id:'1',cliente:'A',situacao:'aberto'}),rec(70,75,{id:'2',cliente:'B',situacao:'aberto'})]):linha([pag(50,2)]));}};return api;}};
 const r=await consultarGiro(sb,{},AGORA);assert.equal(r.semanas.disponivel,true);
 assert.equal(r.semanas.semanas[0].receber,100);assert.equal(r.semanas.semanas[10].receber,70,'+75 dias entra na 11ª semana');assert.equal(r.semanas.semanas[0].pagar,50);
});
function tela(semanas){
 const ctx={structuredClone,document:{addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null},localStorage:{getItem:()=>null,setItem(){}},navigator:{onLine:true},location:{hash:''},URLSearchParams,setTimeout,Promise};vm.createContext(ctx);
 for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','app.js','gestao.js','pdf-cfo.js','parametros.js','dfc.js'])vm.runInContext(ler(f),ctx,{filename:f});
 ctx.run=s=>vm.runInContext(s,ctx);ctx.json=s=>JSON.parse(ctx.run(`JSON.stringify(${s})`));
 ctx.run(`render=()=>{};toast=()=>{};dfcHoje=()=>'2026-10-12';state.records=[];state.cfg={parametros:{}};state.view='caixa';state.periodo='Out/2026';state.permissoes={leitura:true,edicao:true,admin:true};giroUI.dados={semanas:${JSON.stringify(semanas)}};giroUI.em=Date.now()`);return ctx;
}
test('tela: "Trazer da carteira" troca só as linhas da carteira, põe o a pagar vencido na 1ª semana e não o a receber vencido',()=>{
 const sem=semanasCarteira({receber:[rec(1000,0),rec(500,-5)],pagar:[pag(300,3),pag(200,-1),pag(150,70)],receberEm:EM,pagarEm:EM,agora:AGORA});
 const c=tela(sem);c.run(`plano.saldo=5000;plano.movimentos=[{id:'m1',descricao:'Aluguel extra',data:'${d(8)}',tipo:'saida',valor:400}]`);
 c.run('aplicarCarteira();aplicarCarteira()');
 const m=c.json('plano.movimentos');
 assert.equal(m.filter(x=>x.origem!=='carteira').length,1,'a digitada fica');
 assert.equal(m.filter(x=>x.origem==='carteira').length,4,'trazer de novo troca, não duplica');
 assert.deepEqual(m.filter(x=>x.descricao==='Carteira · a pagar vencido').map(x=>[x.data,x.valor]),[[d(0),200]]);
 assert.equal(m.some(x=>x.tipo==='entrada'&&x.valor===500),false,'a receber vencido fica de fora');
 assert.match(m.find(x=>x.valor===150).descricao,/semana 11 .* · carga incompleta/);
 const p=c.json(`F.projecao({...plano,fatorRecebimento:1})`);assert.equal(p.final,5000+1000-300-200-150-400);
 assert.deepEqual(c.json('plano.carteira.incompletas'),[9,10,11,12,13]);assert.equal(c.json('plano.saldo'),5000,'saldo digitado não é trocado');
});
