/* ── AUDITORIA COMPLETA · FASE 10.2 ──────────────────────────────────────────
   Confere todos os meses carregados (de todos os anos), sem mudar nada:
   - estrutura: totais 1 e 2, código repetido, valor que não é número, conta-mãe
     menor que a soma das filhas (impossível) e total que não fecha com as filhas;
   - DRE × caixa: as linhas da DRE Simples fecham com entradas − saídas do ERP;
   - classificação: contas a conferir (sem regra, nova, renomeada) e pendências do robô;
   - coleta: mês passado coletado pela metade; mês sem trilha e API ainda não
     validada ficam como informação;
   - sequência: meses faltando entre o primeiro e o último, período repetido, empresa
     ou critério diferente entre meses;
   - Fluxo de caixa: saldo inicial que falta ou diverge do calculado;
   - cadastros em Parâmetros: alíquota do PGDAS provisória, estoque e saldos do
     balanço (somados no ano todo, para não repetir o mesmo aviso mês a mês);
   - balanço: não somado ou parcial, nos meses com a posição do fim do mês lida.
   Falha = número que não pode estar certo; atenção = precisa de conferência ou de
   cadastro; informação = limite conhecido, dito. Roda no navegador, sobre o que já foi
   carregado da nuvem; nada vai para log nem para fora. */
const AUD_GRUPOS=[['estrutura','Estrutura das contas'],['caixa','DRE × caixa do ERP'],['classificacao','Classificação e pendências'],['coleta','Coleta e cobertura'],['sequencia','Sequência dos meses'],['dfc','Saldos do Fluxo de caixa'],['cadastros','Cadastros em Parâmetros'],['balanco','Balanço gerencial']];
const AUD_NIVEIS={falha:'Falha',atencao:'Atenção',info:'Informação'};
const audUI={resultado:null,nivel:'problemas'};
const audApuracao=new WeakMap();
const audCent=v=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*100):null;
const audDia=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?`${iso.slice(8,10)}/${iso.slice(5,7)}`:'';
const audLista=(xs,max=3)=>xs.slice(0,max).join('; ')+(xs.length>max?`; e mais ${xs.length-max}`:'');
// Meses seguidos viram faixa: "Jan/2015 a Jun/2015".
function audFaixas(labels){
 const g=[];for(const l of labels){const k=monthSortKey(l),u=g[g.length-1];if(u&&k===u.k+1){u.fim=l;u.k=k;}else g.push({ini:l,fim:l,k});}
 return g.map(x=>x.ini===x.fim?x.ini:`${x.ini} a ${x.fim}`);
}
// Um mês: estrutura, DRE × caixa, classificação, coleta, Fluxo de caixa e balanço.
function audMes(reg,ctx){
 const A=[],add=(grupo,nivel,texto)=>A.push({mes:reg.label,grupo,nivel,texto});
 const cells=Array.isArray(reg.cells)?reg.cells:[],mapa=new Map();let repetidos=0,ruins=0;
 for(const c of cells){const k=String(c?.code??'');if(mapa.has(k))repetidos++;mapa.set(k,c);if(audCent(c?.value)==null)ruins++;}
 if(repetidos)add('estrutura','falha',`${repetidos} código(s) de conta repetido(s)`);
 if(ruins)add('estrutura','falha',`${ruins} conta(s) com valor que não é número`);
 for(const [t,n] of [['1','entradas (1)'],['2','saídas (2)']])if(!mapa.has(t))add('estrutura','falha',`sem o total de ${n}`);
 // Conta-mãe contra as filhas diretas: total diferente das filhas, ou mãe menor que elas.
 const filhas=new Map();for(const k of mapa.keys()){const i=k.lastIndexOf('.');if(i>0){const pai=k.slice(0,i);if(!filhas.has(pai))filhas.set(pai,[]);filhas.get(pai).push(k);}}
 const erradas=[];let diretas=0;
 for(const [pai,fs] of filhas){if(!mapa.has(pai))continue;const v=audCent(mapa.get(pai).value),s=fs.reduce((t,k)=>t+(audCent(mapa.get(k).value)??0),0);if(v==null)continue;const d=v-s;
  if(pai==='1'||pai==='2'?Math.abs(d)>1:d<-1)erradas.push(`${pai}: ${money(v/100)} contra ${money(s/100)} nas filhas`);else if(d>1)diretas++;}
 if(erradas.length)add('estrutura','falha',`${erradas.length} conta(s)-mãe não fecham com as filhas: ${audLista(erradas)}`);
 if(diretas)add('estrutura','info',`${diretas} conta(s)-mãe com lançamento direto, além das subcontas`);
 // DRE Simples contra o caixa do ERP.
 let a=null;if(typeof DRESimples!=='undefined'&&mapa.has('1')&&mapa.has('2')){if(!audApuracao.has(reg))audApuracao.set(reg,DRESimples.apurar(reg));a=audApuracao.get(reg);}
 if(a){
  if(Math.abs(a.diferenca||0)>=.01)add('caixa','falha',`as linhas da DRE ficam ${money(Math.abs(a.diferenca))} ${a.diferenca>0?'acima':'abaixo'} do caixa do ERP (${money(a.caixa)})`);
  if(a.linhas?.vendas<0)add('caixa','atencao',`vendas negativas no mês (${money(a.linhas.vendas)})`);
  if(a.conferir?.length)add('classificacao','atencao',`${a.conferir.length} conta(s) a conferir na DRE: ${audLista(a.conferir.map(x=>`${x.code} ${x.name||''} (${x.conferir})`.replace(/\s+/g,' ')))}`);
 }
 const pend=Array.isArray(reg.pendencias)?reg.pendencias:[];
 if(pend.length){const tipos=[...new Set(pend.map(p=>p?.tipo||'sem tipo'))];add('classificacao','atencao',`${pend.length} pendência(s) do robô (${audLista(tipos)})`);}
 // Coleta e cobertura.
 const q=typeof F!=='undefined'?F.qualidade(reg):null,per=typeof F!=='undefined'?F.periodo(reg.label):null;
 if(q?.parcial){if(per&&per.ate>=ctx.hoje)add('coleta','info','mês em andamento');else add('coleta','atencao',`mês já fechado, mas coletado só até ${audDia(q.coletadoAte)||'uma data não registrada'}: atualize o Mubisys ou importe a planilha completa`);}
 if(!Array.isArray(reg.eventos)||!reg.eventos.length)add('coleta','info',reg.origem==='erp'?'sem a trilha por pagamento (carga histórica ou coleta antiga)':'mês de planilha: sem a trilha por pagamento');
 if(reg.qualidade?.apiContratoValidado===false)add('coleta','info','limites da API do Mubisys ainda não validados');
 // Fluxo de caixa.
 const s=ctx.saldos?.get?.(monthSortKey(reg.label));
 if(s){if(s.inicial==null&&!(per&&per.ate>=ctx.hoje))add('dfc','atencao','sem saldo inicial no Fluxo de caixa: informe o saldo bancário de algum mês em Parâmetros');
  if(s.divergencia!=null)add('dfc','atencao',`o saldo inicial informado difere ${money(Math.abs(s.divergencia))} do calculado pelo mês anterior`);}
 // Balanço, quando o histórico de posições foi lido e tem o mês.
 const k=typeof paramMesChave==='function'?paramMesChave(reg.label):null;
 if(ctx.hist?.some(m=>m?.id===k)&&typeof balApurar==='function'){const b=balApurar(reg.label,ctx.hist,ctx.saldos);
  if(!b.apurado)add('balanco','atencao',typeof balNaoSomado==='function'?balNaoSomado(b):'balanço não somado');else if(b.parcial&&typeof balMarca==='function')add('balanco','info',`balanço parcial${balMarca(b).replace(/^ · parcial:/,':')}`);}
 return A;
}
// Todos os meses, de todos os anos: os achados de cada mês e os do conjunto.
function auditarTudo(){
 const hoje=typeof dfcHoje==='function'?dfcHoje():new Date().toISOString().slice(0,10);
 const regs=[...state.records].filter(r=>monthSortKey(r.label)>=0).sort((a,b)=>monthSortKey(a.label)-monthSortKey(b.label));
 const ctx={hoje,saldos:typeof dfcSaldos==='function'?dfcSaldos():new Map(),hist:typeof giroUI!=='undefined'&&Array.isArray(giroUI.dados?.historico?.meses)?giroUI.dados.historico.meses:null};
 const achados=[];for(const r of regs)achados.push(...audMes(r,ctx));
 const add=(mes,grupo,nivel,texto)=>achados.push({mes,grupo,nivel,texto});
 // Sequência: meses faltando entre o primeiro e o último, repetidos e escopo trocado.
 const chaves=[...new Set(regs.map(r=>monthSortKey(r.label)))],rot=k=>PT_MON[k%12]+'/'+Math.floor(k/12);
 if(chaves.length){const faltam=[];for(let k=chaves[0];k<=chaves[chaves.length-1];k++)if(!chaves.includes(k))faltam.push(rot(k));for(const f of audFaixas(faltam))add(f.split(' a ')[0],'sequencia','falha',`${f} sem registro: o ano não fecha sem esse(s) mês(es)`);}
 const dup=typeof dedupePeriods==='function'?dedupePeriods(state.records).dropped:[];for(const d of dup)add(d?.label||'—','sequencia','falha','período com mais de um registro');
 for(let i=1;i<regs.length;i++){const a=regs[i-1],b=regs[i];if(monthSortKey(b.label)!==monthSortKey(a.label)+1)continue;const dif=[a.company!==b.company?'empresa':'',a.basis!==b.basis?'base':'',a.qualidade?.escopo!==b.qualidade?.escopo?'escopo':'',a.qualidade?.regra!==b.qualidade?.regra?'regra de classificação':''].filter(Boolean);if(dif.length)add(b.label,'sequencia','atencao',`${audLista(dif)} diferente de ${a.label}: compare os dois meses com cuidado`);}
 // Cadastros: uma linha por tipo, com os meses em faixa (não repete o aviso mês a mês).
 const fechados=regs.filter(r=>(typeof F!=='undefined'?F.periodo(r.label)?.ate:'')<hoje).map(r=>r.label);
 if(typeof PARAM_EMPRESAS!=='undefined'&&typeof paramAliquota==='function')for(const e of PARAM_EMPRESAS){const ms=fechados.filter(l=>paramAliquota(e.id,l).origem==='padrao');if(ms.length)add('Vários meses','cadastros','atencao',`alíquota do PGDAS da ${e.nome} provisória em ${ms.length} mês(es): ${audLista(audFaixas(ms),4)}`);}
 if(ctx.hist?.length&&typeof paramOperacao==='function'){const com=ctx.hist.map(m=>typeof paramMesLabel==='function'?paramMesLabel(m.id):m.mes);const sem=com.filter(l=>{const v=paramOperacao(l)?.estoque;return v==null||v==='';});if(sem.length)add('Vários meses','cadastros','atencao',`estoque do fim do mês não informado em ${sem.length} mês(es) com posição: ${audLista(audFaixas(sem),4)}`);}
 const ordem={falha:0,atencao:1,info:2};achados.sort((x,y)=>ordem[x.nivel]-ordem[y.nivel]||monthSortKey(x.mes)-monthSortKey(y.mes)||x.grupo.localeCompare(y.grupo));
 const conta=n=>achados.filter(x=>x.nivel===n).length,comProblema=new Set(achados.filter(x=>x.nivel!=='info').map(x=>x.mes));
 return {em:new Date().toISOString(),meses:regs.map(r=>r.label),de:regs[0]?.label||null,ate:regs[regs.length-1]?.label||null,achados,total:{falha:conta('falha'),atencao:conta('atencao'),info:conta('info')},limpos:regs.filter(r=>!comProblema.has(r.label)).length,posicoes:!!ctx.hist};
}
function renderAuditoria(){
 const n=state.records.length,r=audUI.resultado,botoes=`<div class="actions"><button type="button" class="primary" data-aud-rodar>${r?'Rodar de novo':'Rodar auditoria'}</button>${r?'<button type="button" data-aud-csv>Baixar achados (CSV)</button>':''}</div>`;
 const intro=`<p>Confere todos os ${n} meses carregados, de todos os anos, campo a campo: estrutura das contas, DRE contra o caixa do ERP, classificação, coleta, sequência dos meses, saldos do Fluxo de caixa, cadastros e balanço. Nada é alterado; roda neste navegador.</p>`;
 if(!r)return card(`Auditoria completa · ${n} meses`,intro+botoes+'<p class="hint">Para auditar todos os anos, traga antes os meses antigos pela carga histórica (GitHub do DRE, Actions, "Carga histórica do DRE (Mubisys)").</p>');
 const cards=`<div class="cards cards-controle">${recCartao('Meses conferidos',String(r.meses.length),r.de?`${r.de} a ${r.ate}`:'Nenhum mês carregado')}${recCartao('Falhas',String(r.total.falha),'Números que não podem estar certos',r.total.falha?'tom-sai':'')}${recCartao('Atenções',String(r.total.atencao),'Pedem conferência ou cadastro')}${recCartao('Meses sem problema',String(r.limpos),'Sem falha nem atenção',r.limpos&&r.limpos===r.meses.length?'tom-entra':'')}</div>`;
 const problemas=r.achados.filter(x=>x.nivel!=='info'),porGrupo=AUD_GRUPOS.map(([id,nome])=>({rotulo:nome,valor:problemas.filter(x=>x.grupo===id).length})).filter(x=>x.valor>0);
 const g1=recPainel('Onde estão os problemas?','Falhas e atenções por verificação, em todos os meses.',porGrupo.length?gBarrasOrdenadas(porGrupo,{cor:'saida',limite:8,titulo:'Achados por verificação'}):'<p class="hint">Nenhuma falha nem atenção.</p>');
 const ano=String(state.periodo).split('/')[1],mesesAno=PT_MON.map(m=>m+'/'+ano);
 const linhas=AUD_GRUPOS.map(([id,nome])=>({rotulo:nome,valores:mesesAno.map(l=>r.meses.includes(l)||problemas.some(x=>x.mes===l)?problemas.filter(x=>x.grupo===id&&x.mes===l).length:null)}));
 const g2=recPainel(`Em que meses de ${ano}?`,'Quantidade de falhas e atenções por verificação e mês do ano escolhido na barra; mês sem registro fica em branco.',gHeatmap(linhas,PT_MON,{normalizar:'global',formato:v=>`${v} achado(s)`,titulo:`Achados em ${ano}`}));
 const lista=r.achados.filter(x=>audUI.nivel==='todos'||(audUI.nivel==='problemas'?x.nivel!=='info':x.nivel===audUI.nivel));
 const filtro=`<label class="aud-filtro">Mostrar<select data-aud-nivel>${[['problemas','Falhas e atenções'],['falha','Só falhas'],['atencao','Só atenções'],['info','Só informações'],['todos','Tudo']].map(([v,t])=>`<option value="${v}"${audUI.nivel===v?' selected':''}>${t}</option>`).join('')}</select></label>`;
 const tabela=`<div class="table-scroll"><table class="tabela-controle aud-tabela"><caption>${lista.length} achado(s) · auditoria de ${esc(recHora(r.em))}${r.posicoes?'':' · balanço não conferido (histórico de posições não lido)'}</caption><thead><tr><th scope="col">Mês</th><th scope="col">Verificação</th><th scope="col">Nível</th><th scope="col">O que foi achado</th></tr></thead><tbody>${lista.slice(0,500).map(x=>`<tr><th scope="row">${esc(x.mes)}</th><td>${esc(AUD_GRUPOS.find(g=>g[0]===x.grupo)?.[1]||x.grupo)}</td><td class="${x.nivel==='falha'?'tom-sai':''}">${esc(AUD_NIVEIS[x.nivel])}</td><td>${esc(x.texto)}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum achado neste filtro.</td></tr>'}</tbody></table></div>${lista.length>500?`<p class="hint">Mostrando 500 de ${lista.length}; a planilha traz todos.</p>`:''}`;
 return card(`Auditoria completa · ${r.meses.length} meses`,intro+botoes+cards+`<div class="graficos-controle">${g1}${g2}</div>`+filtro+tabela);
}
function audCSV(){
 const r=audUI.resultado;if(!r)return null;
 const rows=[['Auditoria completa do DRE',recHora(r.em)],['Meses conferidos',String(r.meses.length),r.de||'',r.ate||''],['Falhas',String(r.total.falha)],['Atenções',String(r.total.atencao)],['Informações',String(r.total.info)],[],['Mês','Verificação','Nível','O que foi achado'],...r.achados.map(x=>[x.mes,AUD_GRUPOS.find(g=>g[0]===x.grupo)?.[1]||x.grupo,AUD_NIVEIS[x.nivel],x.texto])];
 download('auditoria-dre.csv','﻿'+rows.map(l=>l.map(celulaCSV).join(';')).join('\n'),'text/csv');
 return rows;
}
function wireAuditoria(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('click',e=>{const b=e.target?.closest?.('[data-aud-rodar],[data-aud-csv]');if(!b)return;if(b.hasAttribute('data-aud-csv'))return audCSV();if(typeof carregarGiro==='function')carregarGiro();audUI.resultado=auditarTudo();if(typeof render==='function')render();document.querySelector?.('[data-aud-rodar]')?.focus?.();});
 document.addEventListener('change',e=>{if(e.target?.matches?.('[data-aud-nivel]')){audUI.nivel=e.target.value;if(typeof render==='function')render();document.querySelector?.('[data-aud-nivel]')?.focus?.();}});
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireAuditoria);
