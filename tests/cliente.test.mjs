import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
function client(){const storage=new Map();const ctx={localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{addEventListener(){}},navigator:{onLine:true},crypto:globalThis.crypto};vm.createContext(ctx);vm.runInContext(source,ctx);vm.runInContext('setSyncState=()=>{};',ctx);return ctx;}
test('moeda BR é interpretada sem virar zero',()=>{assert.equal(vm.runInContext(`parseNum('R$ 1.234,56')`,client()),1234.56);});
test('texto monetário inválido é rejeitado',()=>{assert.throws(()=>vm.runInContext(`parseNum('12 reais inválidos')`,client()));});
test('edição durante envio continua na fila até ser confirmada',async()=>{
 const c=client();let release;const sent=[];c.api=(_a,args)=>{sent.push(args.registro.valor);if(sent.length===1)return new Promise(r=>release=r);return Promise.resolve({ok:true});};
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);
 const work=vm.runInContext('trySync()',c);
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:200})`,c);
 release({ok:true});await work;assert.deepEqual(sent,[100,200]);assert.equal(vm.runInContext('getQueue().length',c),0);
});
test('erro permanente nunca descarta dado não salvo',async()=>{const c=client();c.api=async()=>({erro:'Inválido'});vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);for(let i=0;i<27;i++)await vm.runInContext('trySync()',c);assert.equal(vm.runInContext('getQueue().length',c),1);});
test('conflito conserva edição e versão remota para revisão',async()=>{const c=client();c.api=async()=>({conflito:true,servidor:{id:'Ago_2026',valor:150}});vm.runInContext(`adoptServerMonth=()=>{};enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);await vm.runInContext('trySync()',c);assert.equal(vm.runInContext('getQueue()[0]?.registro.valor',c),100);assert.equal(vm.runInContext('getQueue()[0]?.conflito.servidor.valor',c),150);});
test('histórico preserva nomes e metadados de cada mês',()=>{const c=client();const out=vm.runInContext(`monthsToDataset([{id:'Jan_2026',label:'Jan/2026',qualidade:{estado:'parcial'},cells:[{code:'2.1',name:'Antes',value:100}]},{id:'Fev_2026',label:'Fev/2026',cells:[{code:'2.1',name:'Depois',value:200}]}])`,c);assert.deepEqual(Array.from(out.accounts[0].names),['Antes','Depois']);assert.equal(out.registros[0].qualidade.estado,'parcial');});
test('nova edição parte da versão confirmada pelo servidor',async()=>{const c=client();const stamp='2026-09-09T20:00:00Z';c.api=async()=>({ok:true,registro:{id:'Ago_2026',label:'Ago/2026',atualizadoEm:stamp,cells:[{code:'1',value:100},{code:'2',value:0}]}});vm.runInContext(`salvarLocal(monthsToDataset([{id:'Ago_2026',label:'Ago/2026',atualizadoEm:'2026-01-01',cells:[{code:'1',value:100},{code:'2',value:0}]}]));enqueueUpsert(datasetRecords(getCurrentData())[0]);`,c);await vm.runInContext('trySync()',c);assert.equal(vm.runInContext('monthRecord(getCurrentData(),0,"nova").baseAtualizadoEm',c),stamp);});
test('falta de espaço na fila não finge que salvou a edição',()=>{const c=client();c.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};assert.throws(()=>vm.runInContext(`enqueueUpsert({id:'Ago_2026'})`,c));});
test('importação atualiza nome apenas no mês escolhido',()=>{const c=client();const r=vm.runInContext(`(()=>{const d=monthsToDataset([{label:'Jan/2026',cells:[{code:'2',name:'Antes',value:10}]},{label:'Fev/2026',cells:[{code:'2',name:'Velho',value:20}]}]);return monthRecord(upsertMonth(d,'Fev/2026',[{code:'2',name:'Novo',value:30}]),1,'agora')})()`,c);assert.equal(r.cells[0].name,'Novo');});
test('importar mês não inventa contas zeradas de outros períodos',()=>{const c=client();const r=vm.runInContext(`prepararImportacao([{id:'Jan_2026',label:'Jan/2026',cells:[{code:'1',value:10},{code:'2',value:3},{code:'2.99',value:3}]}],'Fev/2026',[{code:'1',name:'Entradas',value:100},{code:'2',name:'Saídas',value:40}])`,c);assert.equal(r.cells.length,2);assert.equal(r.cells[0].value,100);});
test('backup de configurações exclui campos de credenciais e permissões',()=>{const c=client();const r=vm.runInContext(`configSegura({accessToken:'segredo',publicKey:'chave',permissoes:{equipe:'admin'},produtosCodigo:{A:'1.1'},regras:{reserva:100}})`,c);assert.deepEqual(Object.keys(r).sort(),['produtosCodigo','regras']);});

// Sair (25/09/2026): a cópia dos números sai do aparelho junto com a pessoa.
// Edição que não chegou à nuvem é tentada antes e só é apagada com confirmação.
const ler=(c,k)=>vm.runInContext(`localStorage.getItem(${JSON.stringify(k)})`,c);
function prepararSaida(c,{confirma=true}={}){
 const perguntas=[];
 vm.runInContext("document.getElementById=()=>({hidden:false,value:'',close(){}});STORE_KEY='dre_v2_data:equipe';MONTH_TS_KEY='dre_v2_ts:equipe';QUEUE_KEY='dre_v2_queue:equipe';localStorage.removeItem(QUEUE_KEY);localStorage.setItem(STORE_KEY,'{\"registros\":[{\"label\":\"Ago/2026\"}]}');localStorage.setItem(MONTH_TS_KEY,'{\"Ago/2026\":\"x\"}');",c);
 c.confirm=m=>{perguntas.push(m);return confirma;};c.AUTH={esquecer(){c.saiu=true;}};c.clearInterval=()=>{};
 return perguntas;
}
test('sair apaga do aparelho a cópia dos números',async()=>{
 const c=client();const perguntas=prepararSaida(c);
 await vm.runInContext('logout()',c);
 assert.equal(ler(c,'dre_v2_data:equipe'),null);
 assert.equal(ler(c,'dre_v2_ts:equipe'),null);
 assert.equal(perguntas.length,0);assert.equal(c.saiu,true);
});
test('sair com edição presa pergunta antes e, se a pessoa desiste, nada é apagado',async()=>{
 const c=client();const perguntas=prepararSaida(c,{confirma:false});c.api=async()=>{throw new Error('sem rede');};
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);
 await vm.runInContext('logout()',c);
 assert.equal(perguntas.length,1);assert.match(perguntas[0],/Uma edição ainda não chegou à nuvem/);
 assert.equal(c.saiu,undefined);
 assert.equal(vm.runInContext('getQueue().length',c),1);
 assert.notEqual(ler(c,'dre_v2_data:equipe'),null);
});
test('sair com edição presa e confirmação apaga a fila também',async()=>{
 const c=client();prepararSaida(c,{confirma:true});c.api=async()=>{throw new Error('sem rede');};
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);
 await vm.runInContext('logout()',c);
 assert.equal(c.saiu,true);
 assert.equal(ler(c,'dre_v2_queue:equipe'),null);
 assert.equal(ler(c,'dre_v2_data:equipe'),null);
});
test('sair envia antes a edição pendente quando há rede, sem perguntar',async()=>{
 const c=client();const perguntas=prepararSaida(c);const enviados=[];c.api=async(_a,args)=>{enviados.push(args.registro.valor);return {ok:true};};
 vm.runInContext(`enqueueUpsert({id:'Ago_2026',label:'Ago/2026',valor:100})`,c);
 await vm.runInContext('logout()',c);
 assert.deepEqual(enviados,[100]);assert.equal(perguntas.length,0);assert.equal(c.saiu,true);
});

test('leitura remota aparece mesmo sem espaço para cache, preservando a fila',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};c.boot=d=>{c.aplicado=d;};
 c.api=async action=>action==='permissions'?{permissoes:{leitura:true}}:action==='getCfg'?{ok:true,cfg:{}}:{ok:true,itens:[{id:'Set_2026',label:'Set/2026',cells:[{code:'1',value:200},{code:'2',value:40}]}]};
 vm.runInContext(`salvarLocal(monthsToDataset([{id:'Set_2026',label:'Set/2026',cells:[{code:'1',value:100}]}]));setQueue([])`,c);
 c.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
 await vm.runInContext('pullCloud()',c);
 assert.equal(c.aplicado?.registros[0].cells[0].value,200);
 assert.equal(vm.runInContext('getCurrentData().registros[0].cells[0].value',c),200);
 assert.equal(vm.runInContext('getQueue().length',c),0);
});
test('ausência e escopo de um mês não são substituídos pelos do último mês',()=>{
 const c=client();const r=vm.runInContext(`(()=>{const d=monthsToDataset([{id:'Jan_2026',label:'Jan/2026',company:'Impresilk',basis:'Caixa',cells:[{code:'1',value:100}]},{id:'Fev_2026',label:'Fev/2026',company:'Impresilk + Universo',basis:'Caixa gerencial',cells:[{code:'1',value:200},{code:'2',value:50}]}]);return monthRecord(d,0,'agora')})()`,c);
 assert.equal(r.company,'Impresilk');assert.equal(r.basis,'Caixa');assert.equal(r.cells.length,1);
});

// Fase 13: a base não vai mais para o localStorage (5 MB divididos com os outros sistemas); a cópia
// do aparelho fica no IndexedDB (CacheDRE) e a leitura da nuvem baixa só os meses que mudaram.
test('a base não ocupa o localStorage: sem aviso de espaço, a sessão usa o dado e a cópia antiga sai',()=>{
 const c=client();const avisos=[];c.toast=(m,t)=>avisos.push([m,t]);
 vm.runInContext("STORE_KEY='dre_v2_data:eu';QUEUE_KEY='dre_v2_queue:eu'",c);c.localStorage.setItem('dre_v2_data:eu','{"velha":true}');c.localStorage.setItem('dre_v2_queue:eu','[9]');
 c.localStorage.setItem=()=>{throw new DOMException('cheio','QuotaExceededError');};
 for(let i=0;i<3;i++)assert.equal(vm.runInContext(`salvarLocal({n:${i}})`,c),true);
 assert.deepEqual(avisos,[],'nenhum aviso de espaço');assert.equal(vm.runInContext('getCurrentData().n',c),2);
});
function cacheFalso(c,inicial=[]){const banco={meses:new Map(inicial.map(m=>[m.id,m])),base:null,gravacoes:[]};
 c.CacheDRE={disponivel:()=>true,escopo(){},async ler(){return {meses:[...banco.meses.values()],base:banco.base};},async gravar({meses=[],apagar=[],base}={}){banco.gravacoes.push({meses:meses.map(m=>m.id),apagar:[...apagar]});for(const m of meses)banco.meses.set(m.id,m);for(const id of apagar)banco.meses.delete(id);if(base!==undefined)banco.base=base;return true;},async limpar(){banco.meses.clear();banco.base=null;banco.limpo=true;}};return banco;}
const telaFalsa=(c,f=()=>{})=>d=>{f(d);c.aplicado=d;vm.runInContext('state',c).records=(d?.registros||[]).filter(r=>!r.apagado);};
const mes=(id,at,v)=>({id,label:id.replace('_','/'),atualizadoEm:at,cells:[{code:'1',value:v},{code:'2',value:0}]});
test('leitura incremental: índice leve e só os meses novos ou mudados; o que sumiu da nuvem sai do aparelho',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};let boots=0;c.boot=telaFalsa(c,()=>boots++);
 const banco=cacheFalso(c,[mes('Ago_2026','t1',100),mes('Set_2026','t1',200),mes('Jul_2026','t1',50)]);
 const pedidos=[];c.api=async(action,args={})=>{pedidos.push([action,args.ids||null]);
  if(action==='permissions')return {permissoes:{leitura:true}};if(action==='getCfg')return {ok:true,cfg:{},atualizadoEm:'c1'};
  if(action==='indice')return {ok:true,itens:[{id:'Ago_2026',atualizadoEm:'t1'},{id:'Set_2026',atualizadoEm:'t2'},{id:'Out_2026',atualizadoEm:'t1'}]};
  if(action==='buscar')return {ok:true,itens:args.ids.map(id=>mes(id,id==='Set_2026'?'t2':'t1',id==='Set_2026'?250:300))};
  return {ok:false,erro:'inesperado '+action};};
 vm.runInContext("setQueue([])",c);await vm.runInContext('abrirCopiaDoAparelho()',c);
 assert.equal(c.aplicado.registros.length,3,'abre na hora com a cópia do aparelho');
 await vm.runInContext('pullCloud()',c);
 assert.deepEqual(JSON.parse(JSON.stringify(pedidos.filter(p=>p[0]==='buscar').map(p=>p[1]))),[['Set_2026','Out_2026']],'só o que mudou e o que é novo');
 assert.ok(!pedidos.some(p=>p[0]==='list'),'sem baixar a base inteira');
 assert.deepEqual(JSON.parse(JSON.stringify(c.aplicado.registros.map(r=>[r.id,r.cells[0].value]))),[['Ago_2026',100],['Set_2026',250],['Out_2026',300]]);
 assert.equal(banco.meses.has('Jul_2026'),false,'mês que sumiu da nuvem sai do aparelho');assert.equal(banco.meses.get('Set_2026').cells[0].value,250);
 // segunda leitura sem novidade: nada baixado e a tela não é redesenhada
 const antes=boots;pedidos.length=0;await vm.runInContext('pullCloud()',c);
 assert.deepEqual(pedidos.filter(p=>p[0]==='buscar'),[]);assert.equal(boots,antes,'nada novo: sem redesenhar');
});
test('cópia do aparelho em dia: a primeira leitura não redesenha, e mês sem carimbo igual não conta como mudado',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};let boots=0;c.boot=telaFalsa(c,()=>boots++);
 const semCarimbo={id:'Jul_2026',label:'Jul/2026',cells:[{code:'1',value:50},{code:'2',value:0}]};
 const banco=cacheFalso(c,[mes('Ago_2026','t1',100),semCarimbo]);banco.base={versao:1,cfg:{},cfgVersion:'c1',lidoEm:'2026-10-12T10:00:00Z'};
 const pedidos=[];c.api=async(action,args={})=>{pedidos.push(action);
  if(action==='permissions')return {permissoes:{leitura:true}};if(action==='getCfg')return {ok:true,cfg:{},atualizadoEm:'c1'};
  if(action==='indice')return {ok:true,itens:[{id:'Ago_2026',atualizadoEm:'t1'},{id:'Jul_2026',atualizadoEm:null}]};
  if(action==='buscar')return {ok:true,itens:[JSON.parse(JSON.stringify(semCarimbo))]};return {ok:false};};
 vm.runInContext("setQueue([])",c);await vm.runInContext('abrirCopiaDoAparelho()',c);assert.equal(boots,1);
 await vm.runInContext('pullCloud()',c);
 assert.ok(pedidos.includes('buscar'),'sem carimbo, confere o conteúdo');assert.equal(boots,1,'nada mudou: a tela do aparelho fica');
});
test('servidor sem o índice (versão anterior): a lista inteira, como antes, e grava a cópia',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};c.boot=telaFalsa(c);const banco=cacheFalso(c);
 c.api=async action=>action==='permissions'?{permissoes:{leitura:true}}:action==='getCfg'?{ok:true,cfg:{}}:action==='indice'?{erro:'Ação desconhecida: indice'}:{ok:true,itens:[mes('Set_2026','t1',200)],nextOffset:null};
 vm.runInContext("setQueue([])",c);await vm.runInContext('pullCloud()',c);
 assert.equal(c.aplicado.registros[0].cells[0].value,200);assert.equal(banco.meses.size,1);
});
test('edição na fila continua por cima da cópia do aparelho, e a versão confirmada vai para o aparelho',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};c.boot=telaFalsa(c);const banco=cacheFalso(c,[mes('Set_2026','t1',200)]);
 vm.runInContext(`setQueue([]);enqueueUpsert({...${JSON.stringify(mes('Set_2026','local',999))},baseAtualizadoEm:'t1'})`,c);
 await vm.runInContext('abrirCopiaDoAparelho()',c);assert.equal(c.aplicado.registros[0].cells[0].value,999,'offline mostra a edição');
 assert.equal(banco.meses.get('Set_2026').cells[0].value,200,'o aparelho guarda a versão do servidor');
 c.api=async(action,args)=>action==='upsert'?{ok:true,registro:{...args.registro,atualizadoEm:'t9'}}:{ok:true};
 await vm.runInContext('trySync()',c);await new Promise(r=>setTimeout(r,5));
 assert.equal(banco.meses.get('Set_2026').atualizadoEm,'t9');assert.equal(banco.meses.get('Set_2026').cells[0].value,999);
});
test('sair apaga também a cópia do aparelho',async()=>{
 const c=client();const banco=cacheFalso(c,[mes('Set_2026','t1',200)]);prepararSaida(c);await vm.runInContext('logout()',c);assert.equal(banco.limpo,true);
});

// Revisão da Fase 13: a leitura redesenha quando a TELA difere do que foi montado, uma leitura por vez.
const apiBase=(extra={})=>async(action,args={})=>{if(extra[action])return extra[action](args);
 if(action==='permissions')return {permissoes:{leitura:true,edicao:true,admin:false}};if(action==='getCfg')return {ok:true,cfg:{},atualizadoEm:'c1'};return {ok:false,erro:'inesperado '+action};};
test('usar a versão da nuvem num conflito: a leitura seguinte troca a tela, mesmo sem novidade no índice',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};let boots=0;c.boot=telaFalsa(c,()=>boots++);const banco=cacheFalso(c,[mes('Set_2026','S2',200)]);
 vm.runInContext(`setQueue([]);enqueueUpsert({...${JSON.stringify(mes('Set_2026','local',999))},baseAtualizadoEm:'S1'})`,c);
 c.api=apiBase({indice:()=>({ok:true,itens:[{id:'Set_2026',atualizadoEm:'S2'}]}),upsert:()=>({conflito:true,servidor:mes('Set_2026','S2',200)})});
 await vm.runInContext('abrirCopiaDoAparelho()',c);await vm.runInContext('pullCloud()',c);assert.equal(c.aplicado.registros[0].cells[0].value,999,'conflito: a edição fica na tela');
 vm.runInContext('setQueue([])',c);await vm.runInContext('pullCloud()',c);
 assert.equal(c.aplicado.registros[0].cells[0].value,200,'a versão da nuvem volta para a tela');assert.equal(banco.meses.get('Set_2026').cells[0].value,200);
});
test('edição pendente confirmada na leitura: tela e próxima edição partem da versão do servidor',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};c.boot=telaFalsa(c);cacheFalso(c,[mes('Set_2026','S1',200)]);
 vm.runInContext(`setQueue([]);enqueueUpsert({...${JSON.stringify(mes('Set_2026','2026-10-12T09:00:00Z',300))},baseAtualizadoEm:'S1'})`,c);
 await vm.runInContext('abrirCopiaDoAparelho()',c);
 c.api=apiBase({upsert:a=>({ok:true,registro:{...a.registro,atualizadoEm:'S9'}}),indice:()=>({ok:true,itens:[{id:'Set_2026',atualizadoEm:'S9'}]})});
 await vm.runInContext('pullCloud()',c);
 assert.equal(vm.runInContext("state.records.find(r=>r.id==='Set_2026').atualizadoEm",c),'S9');assert.equal(vm.runInContext('getQueue().length',c),0);
});
test('permissões reais chegam à tela aberta pela cópia do aparelho, mesmo sem novidade',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};let boots=0;c.boot=telaFalsa(c,()=>boots++);const banco=cacheFalso(c,[mes('Set_2026','S1',200)]);banco.base={versao:1,cfg:{},cfgVersion:'c1',lidoEm:'x'};
 c.api=apiBase({permissions:()=>({permissoes:{leitura:true,edicao:true,admin:true}}),indice:()=>({ok:true,itens:[{id:'Set_2026',atualizadoEm:'S1'}]})});
 vm.runInContext('setQueue([]);state.permissoes={leitura:true,edicao:false,admin:false}',c);await vm.runInContext('abrirCopiaDoAparelho()',c);await vm.runInContext('pullCloud()',c);
 assert.equal(boots,2,'redesenha com as permissões reais');await vm.runInContext('pullCloud()',c);assert.equal(boots,2,'depois, nada novo não redesenha');
});
test('leituras simultâneas rodam uma de cada vez; erro de rede no índice não baixa a base inteira',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};c.boot=telaFalsa(c);cacheFalso(c,[mes('Set_2026','S1',200)]);
 const ordem=[];let solta;c.api=apiBase({indice:()=>{ordem.push('indice');return ordem.length===1?new Promise(r=>solta=()=>r({ok:true,itens:[{id:'Set_2026',atualizadoEm:'S1'}]})):{ok:true,itens:[{id:'Set_2026',atualizadoEm:'S1'}]};}});
 vm.runInContext('setQueue([])',c);const a=vm.runInContext('pullCloud()',c),b=vm.runInContext('pullCloud()',c);await new Promise(r=>setTimeout(r,5));
 assert.deepEqual(ordem,['indice'],'a segunda espera a primeira');solta();await a;await b;assert.deepEqual(ordem,['indice','indice']);
 const pedidos=[];c.api=async(action)=>{pedidos.push(action);if(action==='indice')throw new TypeError('Failed to fetch');return apiBase()(action);};
 let estado='';vm.runInContext('setSyncState=(e,t)=>{globalThis.__estado=e+":"+t;}',c);await vm.runInContext('pullCloud()',c);
 assert.ok(!pedidos.includes('list'),'sem a lista inteira');assert.match(c.__estado,/^off:/);
});
test('sair durante a leitura: nada é gravado no aparelho nem desenhado',async()=>{
 const c=client();let cracha='a';c.AUTH={temCracha:()=>true,cracha:()=>cracha};c.toast=()=>{};let boots=0;c.boot=telaFalsa(c,()=>boots++);const banco=cacheFalso(c);
 c.api=apiBase({indice:()=>({ok:true,itens:[{id:'Set_2026',atualizadoEm:'S1'}]}),buscar:()=>({ok:true,itens:[mes('Set_2026','S1',200)]}),getCfg:()=>{cracha=null;return {ok:true,cfg:{},atualizadoEm:'c1'};}});
 vm.runInContext('setQueue([])',c);await vm.runInContext('pullCloud()',c);assert.equal(boots,0);assert.equal(banco.gravacoes.length,0);
});
test('falha ao gravar no aparelho: a sessão para de gravar, para a hora da cópia não avançar sem os meses',async()=>{
 const c=client();c.AUTH={temCracha:()=>true};c.toast=()=>{};c.boot=telaFalsa(c);const banco=cacheFalso(c);let tentativas=0;c.CacheDRE.gravar=async()=>{tentativas++;return false;};
 c.api=apiBase({indice:()=>({ok:true,itens:[{id:'Set_2026',atualizadoEm:'S1'}]}),buscar:()=>({ok:true,itens:[mes('Set_2026','S1',200)]})});
 vm.runInContext('setQueue([])',c);await vm.runInContext('pullCloud()',c);await vm.runInContext('pullCloud()',c);assert.equal(tentativas,1);assert.equal(vm.runInContext('state.cacheOk',c),false);
});
