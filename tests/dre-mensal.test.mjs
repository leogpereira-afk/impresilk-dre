import fs from 'node:fs';import vm from 'node:vm';import {test} from 'node:test';import assert from 'node:assert/strict';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../dre-modelo.js',import.meta.url),'utf8'),ctx);const M=ctx.DREModelo;
const valores=(extra={})=>Object.assign(Object.fromEntries(M.campos.map(c=>[c.id,0])),extra);
test('DRE por competência fecha receita, deduções, lucro e financeiro',()=>{
 const r=M.calcular(valores({produtos:1000,tributosVendas:100,custos:400,administrativas:150,despesasFinanceiras:20,tributosLucro:30,da:50}));
 assert.equal(r.liquida,900);assert.equal(r.bruto,500);assert.equal(r.operacional,350);assert.equal(r.liquido,300);assert.equal(r.ebitda,400);
});
test('D&A já incluída não é descontada novamente do lucro',()=>{const r=M.calcular(valores({produtos:100,custos:40,da:10}));assert.equal(r.liquido,60);assert.equal(r.ebitda,70);});
test('campo ausente propaga ausência e não apura lucro falso',()=>{const r=M.calcular({produtos:100,servicos:0,outrasVendas:0});assert.equal(r.bruta,100);assert.equal(r.liquida,null);assert.equal(r.liquido,null);assert.equal(r.ebitda,null);});
test('benefício tributário e resultado de equivalência aceitam sinais',()=>{const r=M.calcular(valores({produtos:100,equivalencia:-5,tributosDiferidos:-3}));assert.equal(r.operacional,95);assert.equal(r.liquido,98);});
test('valores inválidos e despesa negativa sem natureza de ajuste são rejeitados',()=>{assert.throws(()=>M.calcular({produtos:'100'}));assert.throws(()=>M.calcular({custos:-3}));assert.throws(()=>M.calcular({produtos:Infinity}));});
test('margem anual usa totais, não média das margens mensais',()=>{const r=M.acumulado([{valores:valores({produtos:100,custos:50})},{valores:valores({produtos:900,custos:810})}]);assert.equal(r.liquido,140);assert.ok(Math.abs(r.margemLiquida-14)<1e-10);});
test('mês ausente bloqueia acumulado completo e receita zero não gera percentual',()=>{assert.equal(M.acumulado([{valores:valores({produtos:100})},null]).liquido,null);assert.equal(M.calcular(valores()).margemLiquida,null);});
test('operações descontinuadas não integram o subtotal das continuadas',()=>{const r=M.calcular(valores({produtos:100,descontinuadas:-25}));assert.equal(r.continuadas,100);assert.equal(r.liquido,75);});
const C=ctx.DRECompetencia;
const registro=()=>({label:'Set/2026',company:'Empresa exemplo',fonte:'Balancete de teste',valores:valores({produtos:100}),revisao:'revisao-teste',revisadoEm:'2026-09-09T12:00:00Z'});
test('salvar competência preserva regras, permissões e outros meses na versão recém-lida',async()=>{const other={label:'Ago/2026',valores:{produtos:42}};let sent;const api=async(a,p)=>a==='getCfg'?{ok:true,cfg:{regras:{nova:1},permissoes:{p:'admin'},demonstrativosCompetencia:{versao:1,meses:{Ago_2026:other}}},atualizadoEm:'fresh'}:(sent=p,{ok:true,atualizadoEm:'saved'});const r=await C.salvar({api,admin:true,id:'Set_2026',original:null,registro:registro()});assert.equal(sent.baseAtualizadoEm,'fresh');assert.equal(r.cfg.regras.nova,1);assert.equal(r.cfg.permissoes.p,'admin');assert.equal(r.cfg.demonstrativosCompetencia.meses.Ago_2026,other);assert.equal(r.cfg.demonstrativosCompetencia.meses.Set_2026.valores.produtos,100);});
test('mudança concorrente no mesmo mês interrompe a gravação',async()=>{let writes=0;const api=async a=>a==='getCfg'?{ok:true,cfg:{demonstrativosCompetencia:{meses:{Set_2026:{revisao:'outra'}}}}}:(writes++,{ok:true});await assert.rejects(C.salvar({api,admin:true,id:'Set_2026',original:null,registro:registro()}),/mudou/);assert.equal(writes,0);});
test('permissão de leitura não tenta gravar competência',async()=>{let calls=0;await assert.rejects(C.salvar({api:async()=>calls++,admin:false,id:'Set_2026',original:null,registro:registro()}),/administração/);assert.equal(calls,0);});
test('conflito atômico e erro de servidor nunca são sucesso',async()=>{for(const result of [{conflito:true},{erro:'falha'}]){const api=async a=>a==='getCfg'?{ok:true,cfg:{},atualizadoEm:'v1'}:result;await assert.rejects(C.salvar({api,admin:true,id:'Set_2026',original:null,registro:registro()}));}});
test('resposta perdida não repete revisão já salva',async()=>{let writes=0;const reg=registro(),cfg={demonstrativosCompetencia:{meses:{Set_2026:reg}}};const api=async a=>a==='getCfg'?{ok:true,cfg,atualizadoEm:'v1'}:(writes++,{ok:true});const r=await C.salvar({api,admin:true,id:'Set_2026',original:null,registro:reg});assert.equal(r.cfg,cfg);assert.equal(writes,0);});
test('edição mantém histórico limitado e não modifica registro anterior',async()=>{const old={...registro(),revisao:'anterior',historico:[{revisao:'a'},{revisao:'b'},{revisao:'c'}]},copy=JSON.stringify(old);const api=async a=>a==='getCfg'?{ok:true,cfg:{demonstrativosCompetencia:{versao:1,meses:{Set_2026:old}}},atualizadoEm:'v1'}:{ok:true};const r=await C.salvar({api,admin:true,id:'Set_2026',original:old,registro:registro()});assert.equal(r.cfg.demonstrativosCompetencia.meses.Set_2026.historico.length,3);assert.equal(JSON.stringify(old),copy);});
function tela(){const c={document:{addEventListener(){},querySelectorAll:()=>[]},localStorage:{getItem:()=>null}};vm.createContext(c);for(const f of ['financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','cfo-modelo.js','cfo.js','pdf-cfo.js','app.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);vm.runInContext("state.D={accounts:[]};state.periodo='Set/2026';",c);return c;}
test('ambos os demonstrativos renderizam 12 meses sem inventar números em mês vazio',()=>{const c=tela();for(const base of ['caixa','competencia']){const html=vm.runInContext(`dreUI.base='${base}';renderDRE()`,c);assert.match(html,/Jan\/2026/);assert.match(html,/Dez\/2026/);assert.doesNotMatch(html,/NaN|undefined/);assert.match(html,/Não apurado/);}});
test('acumulado por competência bloqueia empresas diferentes',()=>{const c=tela();c.months={Jan_2026:{company:'A',valores:valores({produtos:10})},Fev_2026:{company:'B',valores:valores({produtos:20})}};const r=vm.runInContext("state.periodo='Fev/2026';dreUI.base='competencia';state.cfg={demonstrativosCompetencia:{meses:months}};dadosDRE()",c);assert.equal(r.mesmoEscopo,false);assert.equal(r.soma.liquido,undefined);});
test('glossário busca sem acentos, filtra assuntos e cobre toda a ajuda do DRE',()=>{const c=tela();const out=vm.runInContext("({count:GlossarioFinanceiro.termos.length,busca:GlossarioFinanceiro.buscar('depreciacao'),cats:GlossarioFinanceiro.buscar('','credito'),missing:[...DREModelo.linhas,...linhasCaixa].filter(r=>!GlossarioFinanceiro.termos.some(t=>t.nome===r.termo))})",c);assert.ok(out.count>=70);assert.ok(out.busca.some(t=>t.nome==='Depreciação'));assert.ok(out.cats.every(t=>t.grupo==='credito'));assert.equal(out.missing.length,0);});
test('backup preserva competência e exclui segredos',()=>{const c=tela();const r=vm.runInContext("configSegura({demonstrativosCompetencia:{versao:1,meses:{}},permissoes:{},accessToken:'x'})",c);assert.deepEqual(Object.keys(r),['demonstrativosCompetencia']);});

// Auditoria de HTML (25/09/2026): texto que não nasce no código não vira marcação.
test('rótulo de mês fora do padrão não vira HTML no campo de competência',()=>{
 const c=tela();c.ruim='Jan/2026"><img src=x onerror=alert(1)>';
 const html=vm.runInContext("state.periodo=ruim;dreUI.base='competencia';renderDRE()",c);
 assert.doesNotMatch(html,/<img/);
 const bom=vm.runInContext("state.periodo='Set/2026';dreUI.base='competencia';renderDRE()",c);
 assert.match(bom,/id="drePeriodo"[^>]*value="2026-09"/);
});
test('meta guardada no aparelho com texto não abre o atributo do campo',()=>{
 const c=tela();vm.runInContext(`localStorage.getItem=k=>k===METAS_KEY?JSON.stringify({semAlvoZero:true,'2026':{receita:'1"><img src=x>',custos:5,caixa:null}}):null;localStorage.setItem=()=>{};document.getElementById=()=>({});dialog=(t,h)=>{globalThis.metasHTML=h;};`,c);
 vm.runInContext('formularioMetas()',c);const html=vm.runInContext('metasHTML',c);
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/name="custos"[^>]*value="5"/);
});

// Cor do dinheiro (26/09/2026): o que entrou azul, o que saiu vermelho;
// resultado positivo azul, negativo vermelho; zero e ausência neutros.
test('regra de cor segue o sentido do dinheiro e o sinal do resultado',()=>{
 const c=tela();const t=(id,v)=>vm.runInContext(`tomDoValor(${JSON.stringify(id)},${JSON.stringify(v)})`,c);
 assert.equal(t('entradas',100),'tom-entra');assert.equal(t('saidas',100),'tom-sai');
 assert.equal(t('saidas',-20),'tom-entra','estorno de saída é dinheiro voltando');
 assert.equal(t('entradas',-5),'tom-sai');
 assert.equal(t('variacao',50),'tom-entra');assert.equal(t('variacao',-50),'tom-sai');
 assert.equal(t('liquido',-1),'tom-sai');assert.equal(t('custos',300),'tom-sai');assert.equal(t('margemLiquida',12.5),'tom-entra');
 assert.equal(t('variacao',0),'');assert.equal(t('entradas',null),'');assert.equal(t('da',80),'','depreciação já incluída é informativa');
});
test('matriz do caixa pinta entrada, saída e variação negativa',()=>{
 const c=tela();c.regs=[{id:'Jan_2026',label:'Jan/2026',company:'Impresilk + Universo',basis:'Caixa',origem:'erp',qualidade:{estado:'aguardando-conferencia',ate:'2026-01-31'},cells:[{code:'1',value:100,name:'Receitas',level:1},{code:'1.1',value:100,name:'CV',level:2},{code:'2',value:150,name:'Despesas',level:1}]}];
 const html=vm.runInContext("state.records=regs;state.periodo='Jan/2026';dreUI.base='caixa';renderDRE()",c);
 const celula=id=>(html.match(new RegExp(`<td class="num[^"]*"><button class="cfo-value" data-cfo-rubrica="${id}" data-cfo-period="Jan/2026"`))||[''])[0];
 assert.match(celula('entradas'),/tom-entra/);assert.match(celula('saidas'),/tom-sai/);assert.match(celula('variacao'),/tom-sai/);
 assert.doesNotMatch(celula('entradas'),/tom-sai/);
});

// Coleta (26/09/2026): o GitHub roda a rotina a cada 3–5h; rotina quieta não
// é falha. Cartão só em falha que pede ação — inclusive pedido parado.
function coletaFalsa(c){let html='';const bar={className:'',dataset:{},escritas:0,get innerHTML(){return html;},set innerHTML(x){html=x;bar.escritas++;},querySelector:()=>null},btn={disabled:false,textContent:''};vm.runInContext('document.getElementById=id=>id==="coletaBar"?globalThis.barFalsa:id==="syncBtn"?globalThis.btnFalso:null;',c);c.barFalsa=bar;c.btnFalso=btn;return bar;}
const horasAtras=h=>new Date(Date.now()-h*3600e3).toISOString();
const statusBase=(extra={})=>({titulo:'Última coleta processada',descricao:'Confira os meses.',podeSolicitar:true,status:{ativa:true,estado:'concluido',rotinaVistaEm:horasAtras(3),ultimaTentativa:{em:horasAtras(3),runId:'9',meses:[{label:'Set/2026',estado:'gravado'}]},...extra}});
test('rotina quieta há 3h não vira cartão de alerta',()=>{
 const c=tela(),bar=coletaFalsa(c);c.v=statusBase();vm.runInContext('mostrarColeta(v)',c);
 assert.doesNotMatch(bar.className,/coleta-alerta/);assert.doesNotMatch(bar.innerHTML,/não responde|sem sinal/);
 assert.match(bar.innerHTML,/Mubisys · coletado/);assert.match(bar.innerHTML,/Set\/2026: atualizado/);
});
test('rotina sem sinal há mais de 8h vira ponto âmbar no chip, sem cartão',()=>{
 const c=tela(),bar=coletaFalsa(c);c.v=statusBase({rotinaVistaEm:horasAtras(10)});vm.runInContext('mostrarColeta(v)',c);
 assert.doesNotMatch(bar.className,/coleta-alerta/);assert.match(bar.innerHTML,/coleta-chip warn/);assert.match(bar.innerHTML,/sem sinal há 10h/);
});
test('pedido parado, erro e interrupção continuam chamativos; espera normal fica no chip',()=>{
 const casos=[
  [{estado:'aguardando',solicitadoEm:horasAtras(7),rotinaVistaEm:horasAtras(8)},true,'pedido esperando mais de 6h'],
  [{estado:'aguardando',solicitadoEm:horasAtras(1),rotinaVistaEm:horasAtras(.5)},true,'rotina passou depois do pedido e não pegou'],
  [{estado:'erro'},true,'erro'],[{estado:'interrompido'},true,'interrompido'],
  [{estado:'aguardando',solicitadoEm:horasAtras(2),rotinaVistaEm:horasAtras(3)},false,'espera normal: a rotina ainda não passou'],
 ];
 for(const [extra,cartao,nome] of casos){
  const c=tela(),bar=coletaFalsa(c);c.v=statusBase(extra);vm.runInContext('mostrarColeta(v)',c);
  assert.equal(/coleta-alerta/.test(bar.className),cartao,nome);
  if(!cartao)assert.match(bar.innerHTML,/aguardando a rotina/);
 }
});
test('relógio do aparelho adiantado não inventa alarme quando o servidor informa a hora',()=>{
 const c=tela(),bar=coletaFalsa(c);const agoraServidor=horasAtras(10);
 c.v=statusBase({estado:'aguardando',solicitadoEm:agoraServidor,rotinaVistaEm:horasAtras(11),agora:agoraServidor});
 vm.runInContext('mostrarColeta(v)',c);
 assert.doesNotMatch(bar.className,/coleta-alerta/);
});
test('consulta sem mudança não recria o chip (foco e painel aberto preservados)',()=>{
 const c=tela(),bar=coletaFalsa(c);c.v=statusBase();vm.runInContext('mostrarColeta(v);mostrarColeta(v);mostrarColeta(v)',c);
 assert.equal(bar.escritas,1);
});
test('pedido com rotina acionada: minutos de espera são normais; 20 min sem começar é falha',()=>{
 const c=tela(),bar=coletaFalsa(c);c.v=statusBase({estado:'aguardando',solicitadoEm:horasAtras(5/60),acionadaEm:horasAtras(5/60),rotinaVistaEm:horasAtras(3)});vm.runInContext('mostrarColeta(v)',c);
 assert.doesNotMatch(bar.className,/coleta-alerta/);assert.match(bar.innerHTML,/rotina acionada/);
 const c2=tela(),bar2=coletaFalsa(c2);c2.v=statusBase({estado:'aguardando',solicitadoEm:horasAtras(.5),acionadaEm:horasAtras(.5),rotinaVistaEm:horasAtras(3)});vm.runInContext('mostrarColeta(v)',c2);
 assert.match(bar2.className,/coleta-alerta/);assert.match(bar2.innerHTML,/acionada no GitHub há mais de 20 minutos/);
});

