import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';import {test} from 'node:test';import assert from 'node:assert/strict';
const context={Deno:{env:{get:()=>''},serve:()=>{}},createClient:()=>({}),TextEncoder,TextDecoder,Response,URL,URLSearchParams,AbortController,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(fs.readFileSync(new URL('../supabase/functions/dre-financas/index.ts',import.meta.url),'utf8').replace(/^import .*;$/mg,'')),context);
context.extrairLista=vm.runInContext('extrairLista',context);
for(const [name,t,want] of [
 ['fora do período',{valor_titulo:100,pagamentos:[{data_pagamento:'2026-07-30',valor:100}]},0],
 ['estorno líquido zero',{valor_titulo:100,pagamentos:[{data_pagamento:'2026-08-01',valor:100},{data_pagamento:'2026-08-02',valor:-100}]},0],
 ['baixa no período',{valor_pagamento:40,data_pagamento:'2026-08-04'},40],
 ['fallback fora do período',{valor_pagamento:80,data_pagamento:'2026-07-30'},0]
])test('conector: '+name,()=>assert.equal(context.valorCaixa(t,'2026-08-01','2026-08-31'),want));
test('conector: falha de classificação preserva receita no total',()=>{const r=context.agregarFatias([{rc:{recurso:'contas-receber'},res:{ok:true,data:[{id:1,compoe_dre:'Sim',valor_pagamento:100,data_pagamento:'2026-08-01'}]}}],'2026-08-01','2026-08-31');assert.equal(r.totais.receita,100);assert.equal(r.diag.semCodigo,1);});
test('conector: título repetido entre janelas conta uma vez',()=>{const t={id:1,empresa:'A',compoe_dre:'Sim',plano_contas:'2.1 - Pessoal',pagamentos:[{data_pagamento:'2026-08-01',valor:40},{data_pagamento:'2026-08-09',valor:60}]};const r=context.agregarFatias([1,2].map(()=>({rc:{recurso:'contas-pagar'},res:{ok:true,data:[t]}})),'2026-08-01','2026-08-31');assert.equal(r.totais.despesa,100);assert.equal(r.diag.duplicados,1);});
test('conector: pagamento sem data impede comparação completa',()=>{const r=context.agregarFatias([{rc:{recurso:'contas-pagar'},res:{ok:true,data:[{id:1,compoe_dre:'Sim',pagamentos:[{valor:10}]}]}}],'2026-08-01','2026-08-31');assert.equal(r.parcial,true);});
test('404 de recurso desconhecido não vira lista vazia',()=>assert.equal(context.vazioConfirmado('endpoint-inexistente',{http:404,data:[]}),false));
test('404 só confirma vazio com envelope vazio e recurso conhecido',()=>{assert.equal(context.vazioConfirmado('contas-pagar',{http:404,data:{data:[]}}),true);assert.equal(context.vazioConfirmado('contas-pagar',{http:404,data:{message:'Not found'}}),false);});
test('metadado de próxima página torna resposta incompleta',()=>assert.equal(context.respostaParcial({data:[],has_more:true}),true));
test('resposta vazia ou erro em HTTP 200 não comprova período sem dados',()=>{assert.equal(context.respostaParcial(null),true);assert.equal(context.respostaParcial({error:'erro'}),true);assert.equal(context.respostaParcial({}),true);assert.equal(context.respostaParcial([]),false);});

function apiPaginada(respostas){
  const chamadas=[];let i=0;
  context.fetch=async url=>{chamadas.push(new URL(url));const r=respostas[i++];if(!r)throw new Error('Página além do previsto');return new Response(JSON.stringify(r.data),{status:r.status||200});};
  return chamadas;
}
const creds={base:'https://api.mubisys.com/api',publicKey:'fixture',accessToken:'fixture'};
test('lista financeira percorre as páginas documentadas e preserva todos os títulos',async()=>{
  const calls=apiPaginada([{data:{data:[{id:1}],current_page:1,last_page:2,total:2}},{data:{data:[{id:2}],current_page:2,last_page:2,total:2}}]);
  const r=await context.buscarCompleto('contas-pagar',creds,{status:'PAGO'});
  assert.deepEqual(Array.from(context.extrairLista(r.data),x=>x.id),[1,2]);assert.equal(context.respostaParcial(r.data),false);
  assert.deepEqual(calls.map(u=>u.searchParams.get('page')),['1','2']);assert.equal(calls[0].searchParams.get('per_page'),'500');
});
test('lista sem metadados busca outra página quando recebe o limite de 500',async()=>{
  const calls=apiPaginada([{data:Array.from({length:500},(_,i)=>({id:i+1}))},{data:[{id:501}]}]);
  const r=await context.buscarCompleto('contas-receber',creds,{});assert.equal(context.extrairLista(r.data).length,501);assert.equal(calls.length,2);assert.equal(context.respostaParcial(r.data),false);
});
test('falha na segunda página impede promover total incompleto',async()=>{
  apiPaginada([{data:{data:[{id:1}],has_more:true}},{status:503,data:{error:'indisponível'}}]);
  const r=await context.buscarCompleto('contas-receber',creds,{});assert.equal(context.respostaParcial(r.data),true);assert.equal(context.extrairLista(r.data).length,1);
});
test('API que repete a página é interrompida e marcada incompleta',async()=>{
  const calls=apiPaginada([{data:{data:[{id:1}],has_more:true}},{data:{data:[{id:1}],has_more:true}}]);
  const r=await context.buscarCompleto('contas-receber',creds,{});assert.equal(context.respostaParcial(r.data),true);assert.equal(calls.length,2);
});
test('metadados de total divergente não confirmam coleta completa',async()=>{
  apiPaginada([{data:{data:[{id:1}],current_page:1,last_page:1,total:2}},{data:[]}]);
  const r=await context.buscarCompleto('contas-pagar',creds,{});assert.equal(context.respostaParcial(r.data),true);
});
test('recurso de item único não recebe paginação',async()=>{
  const calls=apiPaginada([{data:{id:10,itens:[]}}]);await context.buscarCompleto('ordem-servico/numero/10',creds,{});assert.equal(calls[0].searchParams.has('page'),false);assert.equal(calls.length,1);
});

test('diagnóstico distingue limite de tempo de erro HTTP sem revelar a resposta do ERP',async()=>{
  context.fetch=async()=>{throw new Error('credencial-e-dado-privado');};
  let r=await context.buscarCompleto('contas-pagar',creds,{});
  assert.equal(r.data.diagnostico.motivo,'tempo-ou-rede');
  assert.equal(JSON.stringify(r).includes('credencial-e-dado-privado'),false);
  apiPaginada([{status:503,data:{error:'dado-privado'}}]);
  r=await context.buscarCompleto('contas-pagar',creds,{});
  assert.equal(r.data.diagnostico.motivo,'http');
  assert.equal(r.data.diagnostico.http,503);
  assert.equal(JSON.stringify(r).includes('dado-privado'),false);
});
test('conferência identifica janela incompleta e pagamentos inválidos por contagem',()=>{
  const r=context.agregarFatias([
    {rc:{recurso:'contas-receber'},a:'2026-08-01',b:'2026-08-07',res:{ok:true,data:{data:[],parcial:true,diagnostico:{motivo:'tempo-ou-rede'}}}},
    {rc:{recurso:'contas-pagar'},a:'2026-08-01',b:'2026-08-07',res:{ok:true,data:[{id:1,compoe_dre:'Sim',pagamentos:[{valor:10}]}]}}
  ],'2026-08-01','2026-08-31');
  assert.equal(r.diag.janelasIncompletas.length,1);
  assert.equal(r.diag.janelasIncompletas[0].motivo,'tempo-ou-rede');
  assert.equal(r.diag.pagamentosInvalidos,1);
  assert.equal(r.parcial,true);
});
