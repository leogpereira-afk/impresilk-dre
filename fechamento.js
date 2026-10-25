/* ── FECHAMENTO DO MÊS · FASE 11.4 ───────────────────────────────────────────
   Uma lista que se confere sozinha, para o mês escolhido na barra, na tela
   Conferência: coleta até o último dia, DRE fechando com o caixa do ERP, contas e
   pendências resolvidas, saldo bancário do mês seguinte informado e batendo com o
   Fluxo de caixa, alíquota do PGDAS, estoque e saldos do balanço, posição do fim do
   mês gravada pelo robô e auditoria do mês sem falha.
   Um administrador marca o mês como fechado (com tudo certo ou com justificativa
   escrita do que ficou pendente); a marca guarda quem, quando e a foto da lista em
   cfg.gestao['fechamento:<mês>'], com o histórico de salvarGestao. Reabrir pede o
   motivo e também fica registrado. Mês fechado aparece como "Fechado" no app inteiro
   (F.qualidade). Nada nos meses é alterado. */
const fechUI={busy:false,erro:'',reabrir:false};
const fechChave=label=>'fechamento:'+safeId(label);
const fechRegistro=label=>state.cfg?.gestao?.[fechChave(label)]||null;
const fechFechado=label=>fechRegistro(label)?.estado==='fechado';
function fechQuem(){try{const p=JSON.parse(atob(AUTH.cracha().split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return String(p.nome||p.sub||'administrador');}catch(_){return 'administrador';}}
const fechData=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?`${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`:'';

// A lista do mês: cada item com ok (true/false) e o que fazer quando falta.
function fechConferir(label){
 const reg=state.records.find(r=>r.label===label)||null,per=F.periodo(label),hoje=typeof dfcHoje==='function'?dfcHoje():new Date().toISOString().slice(0,10);
 const I=[],add=(id,titulo,ok,texto)=>I.push({id,titulo,ok:!!ok,texto});
 if(!reg){add('coleta','Mês coletado até o último dia',false,`${label} ainda não tem dados: use "Atualizar Mubisys" ou importe a planilha.`);return I;}
 const acabou=!!per&&per.ate<hoje,q=F.qualidade(reg);
 add('coleta','Mês coletado até o último dia',acabou&&!q.parcial,!acabou?'O mês ainda não acabou.':q.parcial?`Coletado só até ${fechData(q.coletadoAte)||'uma data não registrada'}: atualize o Mubisys de ${label}.`:`Coletado até ${fechData(q.coletadoAte||per.ate)}.`);
 const a=typeof DRESimples!=='undefined'?DRESimples.apurar(reg):null;
 add('caixa','DRE fecha com o caixa do ERP',a&&Math.abs(a.diferenca)<.01,!a?'Sem contas válidas para apurar a DRE.':Math.abs(a.diferenca)<.01?`Entradas menos saídas = ${money(a.caixa)}, igual à soma das linhas.`:`As linhas ficam ${money(Math.abs(a.diferenca))} ${a.diferenca>0?'acima':'abaixo'} do caixa do ERP: confira no Plano de contas.`);
 const conf=a?.conferir?.length||0,pend=(reg.pendencias||[]).length,osf=(reg.previaERP?.diagOS?.osFaltando||[]).length;
 add('classificacao','Contas e pendências conferidas',!conf&&!pend&&!osf,!conf&&!pend&&!osf?'Nada a conferir.':[conf?`${conf} conta(s) a conferir na DRE`:'',pend?`${pend} pendência(s) a conferir na Fila de conferência`:'',osf?`${osf} O.S. não lida(s) na coleta`:''].filter(Boolean).join('; ')+'.');
 const prox=typeof dfcMesDesloca==='function'?dfcMesDesloca(label,1):null,inf=prox&&typeof dfcSaldoInformado==='function'?dfcSaldoInformado(prox):null,s=prox&&typeof dfcSaldos==='function'?dfcSaldos().get(monthSortKey(prox)):null;
 const saldoInformado=Number.isFinite(inf),saldoCalculado=Number.isFinite(s?.calculado),saldoDif=saldoInformado&&saldoCalculado?(Math.round(inf*100)-Math.round(s.calculado*100))/100:null;
 add('saldo','Saldo bancário do fim do mês informado e batendo',saldoDif===0,!saldoInformado?`Informe em Parâmetros o saldo bancário do início de ${prox} (o saldo real do fim de ${label}).`:!saldoCalculado?`Informado (${money(inf)}); sem saldo calculado para comparar (falta uma sequência completa a partir do saldo anterior).`:saldoDif!==0?`O saldo informado de ${prox} difere ${money(Math.abs(saldoDif))} do calculado pelo Fluxo de caixa: confira lançamentos fora do ERP, tarifas ou contas não coletadas.`:`Informado (${money(inf)}) e igual ao calculado pelo Fluxo de caixa. A igualdade dos saldos não substitui a conciliação dos lançamentos bancários.`);
 const prov=typeof PARAM_EMPRESAS!=='undefined'&&typeof paramAliquota==='function'?PARAM_EMPRESAS.filter(e=>paramAliquota(e.id,label).origem!=='informada').map(e=>e.nome):['Impresilk','Universo'];
 add('aliquota','Alíquota do PGDAS informada',!prov.length,prov.length?`Provisória para ${prov.join(' e ')}: informe em Parâmetros a alíquota do PGDAS de ${label}.`:'Informada para as duas empresas.');
 const op=typeof paramOperacao==='function'?paramOperacao(label):null,estoque=op?.estoque!=null&&op.estoque!=='';
 const campos=[['imobilizado','imobilizado'],['emprestimos','empréstimos'],['parcelamentoDAS','parcelamento do DAS']].map(([c,n])=>({n,b:typeof balCadastro==='function'?balCadastro(label,c):null}));
 const faltam=[...(estoque?[]:['estoque']),...campos.filter(x=>!x.b).map(x=>x.n)],herdados=campos.filter(x=>x.b&&!x.b.proprio).map(x=>`${x.n} de ${x.b.mes}`);
 add('cadastros','Estoque e saldos do balanço informados',!faltam.length,faltam.length?`Falta em Parâmetros: ${faltam.join(', ')}.`:herdados.length?`Informados; herdados: ${herdados.join(', ')} (confira se mudaram).`:'Informados no próprio mês.');
 const h=typeof giroUI!=='undefined'?giroUI.dados?.historico:null,k=typeof paramMesChave==='function'?paramMesChave(label):null;
 add('posicao','Posição do fim do mês gravada pelo robô',!!h?.meses?.some(m=>m?.id===k),!h||h.erro?(typeof giroUI!=='undefined'&&giroUI.busy?'Lendo o histórico de posições…':'O histórico de posições não foi lido: abra Capital de giro ou tente de novo.'):h.meses.some(m=>m?.id===k)?'Gravada.':`Sem a posição de ${label}: rode o robô "Histórico de posições" no GitHub do DRE.`);
 const ctx={hoje,saldos:typeof dfcSaldos==='function'?dfcSaldos():new Map(),hist:h&&!h.erro&&h.meses?.length?h.meses:null,semSaldo:new Set()};
 const audDisponivel=typeof audMes==='function'&&typeof DRESimples!=='undefined',falhas=audDisponivel?audMes(reg,ctx).filter(x=>x.nivel==='falha'):[];
 add('auditoria','Verificações locais sem falha',audDisponivel&&!falhas.length,!audDisponivel?'Verificação local não disponível: recarregue o sistema antes de conferir.':falhas.length?`${falhas.length} falha(s): ${falhas.slice(0,2).map(x=>x.texto).join('; ')}.`:'Sem falha de estrutura ou cálculo nos dados carregados. Cobertura da origem, última execução da coleta e conciliação bancária são verificações separadas.');
 return I;
}
// Ano (chip "Ano"): uma linha por mês de janeiro ao último mês com dados, com a
// situação de cada um e o botão que leva ao mês. Fechar e reabrir continuam por mês.
function renderFechamentoAno(ano){
 const y=String(ano),fim=typeof fimDoAno==='function'?fimDoAno(y):null,ate=fim&&String(fim).endsWith('/'+y)?PT_MON.indexOf(String(fim).split('/')[0]):11;
 if(typeof giroUI!=='undefined'&&!giroUI.dados&&!giroUI.busy&&typeof carregarGiro==='function')carregarGiro();
 const linhas=PT_MON.slice(0,ate+1).map(m=>{
  const label=m+'/'+y,tem=state.records.some(r=>r.label===label);
  let texto,ok;
  if(fechFechado(label)){texto=`${label} · Fechado`;ok=true;}
  else if(!tem){texto=`${label} · Sem dados coletados`;ok=false;}
  else{const itens=fechConferir(label),n=itens.filter(x=>x.ok).length;texto=`${label} · ${n} de ${itens.length} itens certos`;ok=n===itens.length;}
  return `<li class="${ok?'st-ok':'st-atencao'}"><b>${ok?'✅':'⚠️'} ${esc(texto)}</b> <button type="button" data-period="${esc(label)}">Abrir ${esc(label)}</button></li>`;
 }).join('');
 return card(`Fechamento por mês · ${y}`,`<p>O fechamento é por mês: abra um mês para ver a lista completa e marcá-lo como fechado. Fechar não muda nenhum número.</p><ul class="fech-lista fech-ano" style="list-style:none;padding:0;margin:0 0 12px;display:grid;gap:8px">${linhas}</ul>`,true);
}
function renderFechamento(){
 if(typeof telaNoAno==='function'&&telaNoAno())return renderFechamentoAno(typeof anoDaTela==='function'?anoDaTela():String(state.periodo).split('/')[1]);
 const label=state.periodo,reg=fechRegistro(label),fechado=reg?.estado==='fechado',itens=fechConferir(label),pend=itens.filter(x=>!x.ok),admin=!!state.permissoes?.admin;
 if(typeof giroUI!=='undefined'&&!giroUI.dados&&!giroUI.busy&&typeof carregarGiro==='function')carregarGiro();
 const lista=`<ul class="fech-lista" style="list-style:none;padding:0;margin:0 0 12px;display:grid;gap:8px">${itens.map(x=>`<li class="${x.ok?'st-ok':'st-atencao'}"><b>${x.ok?'✅':'⚠️'} ${esc(x.titulo)}</b><br><small>${esc(x.texto)}</small></li>`).join('')}</ul>`;
 const status=fechado?`<p class="note"><b>Fechado</b> por ${esc(reg.por||'—')} em ${esc(dataBR(reg.em||reg.atualizadoEm))}${reg.pendentes?.length?` · com ${reg.pendentes.length} item(ns) justificado(s): ${esc(reg.justificativa||'')}`:''}.</p>`:reg?.estado==='reaberto'?`<p class="param-avisos">Reaberto por ${esc(reg.por||'—')} em ${esc(dataBR(reg.em||reg.atualizadoEm))}: ${esc(reg.motivo||'')}</p>`:'';
 let acoes='';
 if(!admin)acoes='<p class="hint">Só um administrador marca o mês como fechado.</p>';
 else if(fechado)acoes=fechUI.reabrir?`<label>Por que reabrir ${esc(label)}?<textarea data-fech-motivo maxlength="500" rows="2"></textarea></label><div class="actions"><button type="button" data-fech-reabrir-ok ${fechUI.busy?'disabled':''}>Confirmar reabertura</button><button type="button" data-fech-cancelar>Cancelar</button></div>`:`<div class="actions"><button type="button" data-fech-reabrir>Reabrir ${esc(label)}</button></div>`;
 else acoes=`${pend.length?`<label>Justificativa dos ${pend.length} item(ns) com ⚠️ (obrigatória para fechar assim)<textarea data-fech-just maxlength="500" rows="2"></textarea></label>`:''}<div class="actions"><button type="button" class="primary" data-fech-fechar ${fechUI.busy?'disabled':''}>Marcar ${esc(label)} como fechado</button></div>`;
 const intro=`<p>${pend.length?`${itens.length-pend.length} de ${itens.length} itens certos.`:'Todos os itens certos.'} A lista se confere sozinha com os dados carregados; fechar não muda nenhum número, só registra quem fechou, quando e como estava.</p>`;
 return card(`Fechamento de ${label}${fechado?' · Fechado':''}`,intro+status+lista+acoes+(fechUI.erro?`<p class="param-avisos" role="alert">${esc(fechUI.erro)}</p>`:''),!fechado);
}
async function fechSalvar(valor){
 const label=state.periodo;fechUI.busy=true;fechUI.erro='';if(typeof render==='function')render();
 try{await salvarGestao(fechChave(label),valor,fechRegistro(label));fechUI.reabrir=false;toast(valor.estado==='fechado'?`${label} marcado como fechado.`:`${label} reaberto.`);}
 catch(e){fechUI.erro=e.message||'Não foi possível gravar.';}
 finally{fechUI.busy=false;if(typeof render==='function')render();}
}
function wireFechamento(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{
  const b=e.target?.closest?.('[data-fech-fechar],[data-fech-reabrir],[data-fech-reabrir-ok],[data-fech-cancelar]');if(!b||fechUI.busy)return;
  const label=state.periodo;
  if(b.hasAttribute('data-fech-reabrir')){fechUI.reabrir=true;render();return;}
  if(b.hasAttribute('data-fech-cancelar')){fechUI.reabrir=false;render();return;}
  if(b.hasAttribute('data-fech-reabrir-ok')){const motivo=String(document.querySelector('[data-fech-motivo]')?.value||'').trim();if(!motivo){fechUI.erro='Escreva por que o mês está sendo reaberto.';render();return;}fechSalvar({estado:'reaberto',mes:label,por:fechQuem(),em:new Date().toISOString(),motivo});return;}
  const itens=fechConferir(label),pend=itens.filter(x=>!x.ok),just=String(document.querySelector('[data-fech-just]')?.value||'').trim();
  if(pend.length&&!just){fechUI.erro='Há itens com ⚠️: escreva a justificativa para fechar assim, ou resolva-os antes.';render();return;}
  fechSalvar({estado:'fechado',mes:label,por:fechQuem(),em:new Date().toISOString(),itens:itens.map(x=>({id:x.id,ok:x.ok,texto:x.texto})),pendentes:pend.map(x=>x.id),justificativa:just});
 });
}
// "Fechado" no app inteiro: o mês fechado (e coletado até o fim) troca o rótulo da qualidade.
if(typeof DREFinancas!=='undefined'&&!DREFinancas.__fechamento){
 const original=DREFinancas.qualidade;DREFinancas.__fechamento=true;
 DREFinancas.qualidade=function(reg,agora){const q=original(reg,agora);if(!reg||q.parcial||typeof state==='undefined'||!fechFechado(reg.label))return q;const f=fechRegistro(reg.label);return {...q,estado:'fechado',rotulo:'Fechado',mensagem:`Mês fechado por ${f.por||'um administrador'} em ${dataBR(f.em||f.atualizadoEm)}. ${q.mensagem}`};};
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireFechamento);
