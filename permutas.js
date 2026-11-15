/* Visão privada das quitações em permuta. Não altera a base financeira. */
const permutasTela={ano:'todos',mes:'todos',lado:'todos',busca:''};
function permutasModelo(records,f={}){
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const selecionados=records.filter(r=>{const [m,a]=r.label.split('/');return (!f.ano||f.ano==='todos'||a===f.ano)&&(!f.mes||f.mes==='todos'||m===f.mes);});
 const meses=[],itens=[];let semBase=0,semDetalhes=0;
 for(const r of selecionados){
  const d=r.permutasDetalhes?.versaoDetalhes===1?r.permutasDetalhes:null,p=d||r.permutas;
  if(!p||!['entradas','saidas'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k]))){semBase++;continue;}
  if(!d)semDetalhes++;
  const xs=(d?.itens||[]).filter(i=>(!f.lado||f.lado==='todos'||i.lado===f.lado)&&(!f.busca||norm(i.contraparte).includes(norm(f.busca))));
  itens.push(...xs.map(i=>({...i,mes:r.label,divergente:d.totaisConferemDRE===false})));
  const total=k=>Math.round(xs.filter(i=>!i.mista&&i.lado===k).reduce((s,i)=>s+Math.round(i.valor*100),0))/100;
  const misto=k=>Math.round(xs.filter(i=>i.mista&&i.lado===k).reduce((s,i)=>s+Math.round(i.valor*100),0))/100;
  meses.push({mes:r.label,entradas:f.busca?total('entrada'):(f.lado==='saida'?0:p.entradas),saidas:f.busca?total('saida'):(f.lado==='entrada'?0:p.saidas),mistosEntradas:f.busca?misto('entrada'):(f.lado==='saida'?0:p.mistosEntradas||0),mistosSaidas:f.busca?misto('saida'):(f.lado==='entrada'?0:p.mistosSaidas||0),semForma:p.naoIdentificados||0,divergente:d?.totaisConferemDRE===false,detalhado:!!d});
 }
 const sum=k=>meses.reduce((s,m)=>s+Math.round(m[k]*100),0)/100;
 return {meses,itens:itens.sort((a,b)=>b.data.localeCompare(a.data)),entradas:sum('entradas'),saidas:sum('saidas'),mistosEntradas:sum('mistosEntradas'),mistosSaidas:sum('mistosSaidas'),semBase,semDetalhes,selecionados:selecionados.length};
}
function renderPermutas(){
 const f=permutasTela,m=permutasModelo(state.records,f),anos=[...new Set(state.records.map(r=>r.label.split('/')[1]))].sort().reverse();
 const opt=(v,t,sel)=>`<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(t)}</option>`;
 const tabela=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(t=>`<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
 const fmt=(v)=>m.meses.length?money(v):'Não apurado';
 let h=`<section class="panel"><div class="permuta-filtros"><label>Ano<select id="permutaAno">${opt('todos','Todos os anos',f.ano)}${anos.map(a=>opt(a,a,f.ano)).join('')}</select></label><label>Mês<select id="permutaMes">${opt('todos','Todos os meses',f.mes)}${PT_MON.map(a=>opt(a,a,f.mes)).join('')}</select></label><label>Movimento<select id="permutaLado">${[['todos','Recebimentos e pagamentos'],['entrada','Recebimentos'],['saida','Pagamentos']].map(([a,b])=>opt(a,b,f.lado)).join('')}</select></label><label>Com quem<input id="permutaBusca" type="search" placeholder="Buscar nome" value="${esc(f.busca)}"></label><button id="permutaLimpar">Limpar filtros</button></div><p>Quitações cuja forma de pagamento contém permuta, no escopo “compõe DRE” do Mubisys. Valores mistos ficam separados. Recebimentos e pagamentos não são somados entre si, pois podem representar os dois lados da mesma troca.</p></section>`;
 h+=`<div class="cards finance-kpis"><div class="metric"><span>Recebimentos em permuta</span><strong>${fmt(m.entradas)}</strong><small>Sem entrada de dinheiro</small></div><div class="metric"><span>Pagamentos em permuta</span><strong class="tom-sai">${fmt(m.saidas)}</strong><small>Sem saída de dinheiro</small></div><div class="metric"><span>Mistos · divisão pendente</span><strong>${fmt(m.mistosEntradas+m.mistosSaidas)}</strong><small>Entradas ${money(m.mistosEntradas)} · saídas ${money(m.mistosSaidas)}</small></div></div>`;
 h+=`<p class="hint">${m.selecionados} ${m.selecionados===1?'mês':'meses'} no filtro · ${m.selecionados-m.semDetalhes-m.semBase} com detalhamento · ${m.semDetalhes} aguardando nomes e datas · ${m.semBase} sem base de permutas. ${f.busca?'Busca por nome considera somente meses detalhados. ':''}Totais são das permutas identificadas; não representam saldo de caixa ou saldo a compensar.</p>`;
 if(m.meses.some(x=>x.divergente||x.semForma))h+=`<p class="status">Há meses com forma de pagamento ausente ou divergência entre o Mubisys e a DRE. Os valores originais da DRE estão preservados; esta visão mostra a consulta de permutas do Mubisys.</p>`;
 const anosTotais=new Map();for(const x of m.meses){const ano=x.mes.split('/')[1],a=anosTotais.get(ano)||{ano,entradas:0,saidas:0,mistos:0,meses:0};a.entradas+=Math.round(x.entradas*100);a.saidas+=Math.round(x.saidas*100);a.mistos+=Math.round((x.mistosEntradas+x.mistosSaidas)*100);a.meses++;anosTotais.set(ano,a);}
 h+=`<section class="panel"><h2>Por ano</h2>${tabela(['Ano','Meses com base','Recebimentos','Pagamentos','Mistos'],[...anosTotais.values()].sort((a,b)=>b.ano.localeCompare(a.ano)).map(a=>`<tr><td><button data-permuta-ano="${esc(a.ano)}">${esc(a.ano)}</button></td><td>${a.meses}</td><td class="tom-entra">${money(a.entradas/100)}</td><td class="tom-sai">${money(a.saidas/100)}</td><td>${money(a.mistos/100)}</td></tr>`).join('')||'<tr><td colspan="5">Sem base neste filtro.</td></tr>')}</section>`;
 h+=`<details class="panel" ${f.mes!=='todos'?'open':''}><summary><strong>Por mês · abrir detalhes</strong></summary>${tabela(['Mês','Recebimentos','Pagamentos','Mistos','Conferência'],m.meses.map(x=>`<tr><td><button data-permuta-periodo="${esc(x.mes)}">${esc(x.mes)}</button></td><td class="tom-entra">${money(x.entradas)}</td><td class="tom-sai">${money(x.saidas)}</td><td>${money(x.mistosEntradas+x.mistosSaidas)}</td><td>${x.divergente?'Total da origem difere da DRE. ':''}${x.semForma?`${x.semForma} baixa(s) sem forma. `:''}${x.mistosEntradas||x.mistosSaidas?'Divisão dos mistos pendente. ':''}${x.detalhado?'Detalhado':'Nomes e datas em coleta'}</td></tr>`).join('')||'<tr><td colspan="5">Nenhum mês com base disponível neste filtro.</td></tr>')}</details>`;
 const grupos=new Map();for(const i of m.itens.filter(i=>!i.mista)){const k=i.contraparte;const g=grupos.get(k)||{nome:k,entrada:0,saida:0};g[i.lado]+=Math.round(i.valor*100);grupos.set(k,g);}
 h+=`<section class="panel"><h2>Com quem permutou</h2>${tabela(['Contraparte','Recebimentos','Pagamentos'],[...grupos.values()].sort((a,b)=>b.entrada+b.saida-a.entrada-a.saida).map(g=>`<tr><td><button data-permuta-pessoa="${esc(g.nome)}">${esc(g.nome)}</button></td><td class="tom-entra">${money(g.entrada/100)}</td><td class="tom-sai">${money(g.saida/100)}</td></tr>`).join('')||'<tr><td colspan="3">Nenhuma permuta pura detalhada neste filtro. Consulte a cobertura acima.</td></tr>')}</section>`;
 h+=`<section class="panel"><h2>Datas e contas</h2><p>${m.itens.length} quitações no filtro. Os mistos não entram nos totais de permutas puras.</p>${tabela(['Data','Com quem','Movimento','Conta','Valor','Forma / conferência'],m.itens.map(i=>`<tr><td>${esc(i.data.split('-').reverse().join('/'))}</td><td>${esc(i.contraparte)}</td><td>${i.lado==='entrada'?'Recebimento':'Pagamento'}</td><td>${esc(i.nomeConta||i.conta||'Não informada')}</td><td class="${i.lado==='entrada'?'tom-entra':'tom-sai'}">${money(i.valor)}</td><td>${i.mista?'Misto · falta dividir':'Permuta'}${i.divergente?' · total do mês a conferir':''}</td></tr>`).join('')||'<tr><td colspan="6">Sem detalhes disponíveis neste filtro.</td></tr>')}</section>`;
 return h;
}
function wirePermutas(){
 for(const [id,key] of [['permutaAno','ano'],['permutaMes','mes'],['permutaLado','lado'],['permutaBusca','busca']]){const e=document.getElementById(id);if(e)e.onchange=()=>{permutasTela[key]=e.value.trim();render();};}
 const b=document.getElementById('permutaLimpar');if(b)b.onclick=()=>{Object.assign(permutasTela,{ano:'todos',mes:'todos',lado:'todos',busca:''});render();};
 document.querySelectorAll('[data-permuta-periodo]').forEach(b=>b.onclick=()=>{const [mes,ano]=b.dataset.permutaPeriodo.split('/');Object.assign(permutasTela,{ano,mes});render();});
 document.querySelectorAll('[data-permuta-ano]').forEach(b=>b.onclick=()=>{Object.assign(permutasTela,{ano:b.dataset.permutaAno,mes:'todos'});render();});
 document.querySelectorAll('[data-permuta-pessoa]').forEach(b=>b.onclick=()=>{permutasTela.busca=b.dataset.permutaPessoa;render();});
}
