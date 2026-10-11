/* ── PARÂMETROS (Fase 2) ──────────────────────────────────────────────────
   Cadastro revisado por administrador, mês a mês, em cfg.parametros:
   - empresas[id]            = {cnpj, sede}
   - simples[AAAA-MM][id]    = {anexo, rbt12, aliquota, folha12, revisadoEm}
   - operacao[AAAA-MM]       = {prazoRecebimento, prazoPagamento, estoque,
                                saldoInicial, metaReceita, metaResultado, pdd90, revisadoEm}
   - tributos[conta]         = {local, empresa, recorrencia, vencimento, previsto,
                                observacao, revisadoEm}
   - historico               = [{em, caminho, anterior, novo}] (últimas 300)
   Campo vazio fica null e aparece como "Não apurado": nada vira zero. A
   alíquota efetiva ainda não informada aparece com o padrão provisório,
   sempre marcado, e nunca é gravada como se tivesse sido informada.
   O DAS de cada empresa é pago no mês seguinte ao da competência (2.4.1.2 e
   2.4.1.3); o parcelamento (2.4.1.1) é dívida e fica à parte. */
// O imposto do Simples do mês sai do PGDAS em duas contas: DAS (2.4.1) e DARF (2.4.3),
// cada uma com uma subconta por empresa. O parcelamento (2.4.1.1) é dívida.
const PARAM_EMPRESAS=[{id:'impresilk',nome:'Impresilk',das:'2.4.1.2',darf:'2.4.3.1'},{id:'universo',nome:'Universo',das:'2.4.1.3',darf:'2.4.3.2'}];
const PARAM_DAS='2.4.1',PARAM_DARF='2.4.3',PARAM_DAS_PARCELAMENTO='2.4.1.1',PARAM_IMPOSTOS='2.4';
const PARAM_ANEXOS=['I','II','III','IV','V'];
// Padrão provisório até o extrato do PGDAS-D de cada empresa: aparece marcado
// em todo lugar, não entra em gráfico e não é gravado como valor informado.
const PARAM_ALIQUOTA_PADRAO=6;
const PARAM_TETO=4800000,PARAM_SUBLIMITE=3600000,PARAM_FATOR_R=28,PARAM_HISTORICO_MAX=300;
const PARAM_RECORRENCIAS=['Mensal','Anual (parcela única)','Anual parcelado','Eventual'];
const PARAM_CAMPOS={
 simples:{anexo:'Anexo',rbt12:'RBT12',aliquota:'Alíquota efetiva',folha12:'Folha de 12 meses'},
 operacao:{prazoRecebimento:'Prazo de recebimento',prazoPagamento:'Prazo de pagamento',estoque:'Estoque no fim do mês',saldoInicial:'Saldo bancário no início do mês',metaReceita:'Meta de receita',metaResultado:'Meta de resultado',pdd90:'Provisão acima de 90 dias'},
 tributos:{local:'Local',empresa:'Empresa',recorrencia:'Recorrência',vencimento:'Dia de vencimento',previsto:'Valor previsto',observacao:'Observação'},
 empresas:{cnpj:'CNPJ',sede:'Sede'},
 restauracao:{backup:'Backup de'}
};
// Como cada campo numérico é lido e mostrado (no formato brasileiro).
const PARAM_FORMATO={rbt12:'moeda',folha12:'moeda',estoque:'moeda',saldoInicial:'moeda',metaReceita:'moeda',metaResultado:'moeda',previsto:'moeda',aliquota:'pct',pdd90:'pct',prazoRecebimento:'int',prazoPagamento:'int',vencimento:'int'};

// ── meses ───────────────────────────────────────────────────────────────
function paramMesChave(label){const [m,a]=String(label||'').split('/'),i=PT_MON.indexOf(m);return i<0||!/^\d{4}$/.test(a||'')?null:`${a}-${String(i+1).padStart(2,'0')}`;}
function paramMesLabel(chave){const [a,m]=String(chave||'').split('-');return PT_MON[Number(m)-1]?PT_MON[Number(m)-1]+'/'+a:String(chave||'');}
function paramMesDesloca(label,n){const k=paramMesChave(label);if(!k)return null;const [a,m]=k.split('-').map(Number),t=a*12+(m-1)+n;return PT_MON[((t%12)+12)%12]+'/'+Math.floor(t/12);}
function paramMesesDoAno(label){const a=String(label||'').split('/')[1];return /^\d{4}$/.test(a||'')?PT_MON.map(m=>m+'/'+a):[];}
const paramReg=label=>state.records.find(r=>r.label===label)||null;
const paramDiaMes=iso=>/^\d{4}-\d{2}-\d{2}/.test(iso||'')?`${iso.slice(8,10)}/${iso.slice(5,7)}`:'';

// ── números ─────────────────────────────────────────────────────────────
const paramNum=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
const paramPct=(v,d=2)=>paramNum(v)?Number(v).toLocaleString('pt-BR',{minimumFractionDigits:Math.min(2,d),maximumFractionDigits:Math.max(2,d)})+'%':'Não apurado';
const paramDias=v=>paramNum(v)?`${Number(v)} ${Number(v)===1?'dia':'dias'}`:'Não apurado';
// Número digitado no formato brasileiro: "1.200.000,00", "7,45", "R$ 1.500" e
// também "7.45". Devolve null para vazio e NaN para o que não for número, para
// que a validação avise em vez de gravar outra coisa.
function paramNumeroBR(v){
 let s=String(v??'').trim().replace(/^R\$/i,'').replace(/%$/,'').replace(/\s/g,'');
 if(s==='')return null;
 if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)||/^-?\d+,\d+$/.test(s))s=s.replace(/\./g,'').replace(',','.');
 else if(!/^-?\d+(\.\d+)?$/.test(s))return NaN;
 return Number(s);
}
// Valor gravado de volta ao campo, no formato que paramNumeroBR lê.
function paramParaCampo(nome,v){
 if(v==null||v==='')return '';const f=PARAM_FORMATO[nome];if(!f||!paramNum(v))return String(v);
 if(f==='moeda')return Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 if(f==='pct')return Number(v).toLocaleString('pt-BR',{maximumFractionDigits:4});
 return String(v);
}
function paramCnpjValido(v){
 const d=String(v||'').replace(/\D/g,'');if(d.length!==14||/^(\d)\1+$/.test(d))return false;
 const dv=n=>{const pesos=n===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const s=pesos.reduce((t,p,i)=>t+Number(d[i])*p,0)%11;return s<2?0:11-s;};
 return dv(12)===Number(d[12])&&dv(13)===Number(d[13]);
}
const paramCnpjFmt=d=>/^\d{14}$/.test(d||'')?d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):'';
// Comparação que não depende da ordem das chaves: o jsonb do Postgres devolve
// as chaves em outra ordem, e isso não é mudança de ninguém.
const paramCanon=v=>Array.isArray(v)?v.map(paramCanon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,paramCanon(v[k])])):v;
const paramIgual=(a,b)=>JSON.stringify(paramCanon(a??null))===JSON.stringify(paramCanon(b??null));
// Tom do dinheiro numa conta de saída: pago é vermelho; estorno (negativo), azul.
const paramTom=v=>v>0?'tom-sai':v<0?'tom-entra':'';

// ── leitura do cadastro ─────────────────────────────────────────────────
const paramCfg=()=>state.cfg?.parametros||{};
const paramSimples=(empresa,label)=>paramCfg().simples?.[paramMesChave(label)]?.[empresa]||null;
const paramOperacao=label=>paramCfg().operacao?.[paramMesChave(label)]||null;
// Alíquota do mês: a informada vale; sem ela, o padrão provisório, marcado.
function paramAliquota(empresa,label){const p=paramSimples(empresa,label);return paramNum(p?.aliquota)?{valor:Number(p.aliquota),origem:'informada'}:{valor:PARAM_ALIQUOTA_PADRAO,origem:'padrao'};}
// Fator R = folha de 12 meses ÷ RBT12 (em %), só para Anexo III ou V, sem
// arredondar: o limite de 28% é comparado com a razão exata. Retiradas dos
// sócios não entram: não há pró-labore.
function paramFatorR(p){return p&&['III','V'].includes(p.anexo)&&paramNum(p.folha12)&&Number(p.rbt12)>0?Number(p.folha12)/Number(p.rbt12)*100:null;}
// Para mostrar, corta (não arredonda): 27,996% aparece 27,99%, nunca 28,00%.
const paramFatorRTexto=f=>f==null?'Não apurado':paramPct(Math.floor(f*100)/100);
// Valor pago numa conta no mês. Sem o mês coletado: Não apurado. Mês coletado
// sem lançamento na conta: zero de fato, sempre dito como "sem lançamento".
// Mês em andamento entra marcado "até dd/mm" e fica hachurado na série mensal.
function paramMesInfo(label){
 const reg=paramReg(label);if(!reg)return null;
 // .parcial é o fato (coletado só até antes do fim do mês); o estado pode dizer
 // 'desatualizado' e esconder que o mês ainda está em andamento.
 const q=F.qualidade(reg);return {reg,parcial:!!q.parcial,ate:q.coletadoAte||null};
}
function paramPago(label,code){
 const m=paramMesInfo(label);if(!m)return {valor:null,estado:'sem-mes'};
 const v=F.valorConta(m.reg,code);
 return {valor:v==null?0:v,estado:m.parcial?'parcial':v==null?'sem-lancamento':'ok',parcial:m.parcial,ate:m.ate,semLancamento:v==null};
}
const paramAteTexto=p=>p?.parcial?` até ${paramDiaMes(p.ate)||'agora'} (mês em andamento)`:'';
// DAS do mês pela conta 2.4.1: as guias de cada empresa, o parcelamento e o
// que estiver lançado no DAS fora dessas subcontas (resto), que nunca some.
function paramDasMes(label){
 const m=paramMesInfo(label);if(!m)return null;
 const v=c=>F.valorConta(m.reg,c),soma=(...xs)=>xs.every(x=>x==null)?null:Math.round(xs.reduce((t,x)=>t+(x||0),0)*100)/100;
 const guias=Object.fromEntries(PARAM_EMPRESAS.map(e=>[e.id,soma(v(e.das),v(e.darf))])),parc=v(PARAM_DAS_PARCELAMENTO),total=soma(v(PARAM_DAS),v(PARAM_DARF));
 const conhecido=Object.values(guias).reduce((s,x)=>s+(x||0),0)+(parc||0);
 const resto=total==null?0:Math.round((total-conhecido)*100)/100;
 return {guias,parc,total,resto:Math.abs(resto)>=.01?resto:0,parcial:m.parcial,ate:m.ate};
}

// ── impostos e taxas fora do Simples (DAS e DARF), a partir das contas 2.4 ───────────────
function paramNomeConta(code){
 for(const r of [...state.records].sort((a,b)=>monthSortKey(b.label)-monthSortKey(a.label))){const c=r.cells?.find(c=>c.code===code);if(c?.name)return c.name;}
 return code;
}
// " · Mubisys 2.3.2" ao lado do código do painel (com o mês, para achar a origem de conta renomeada)
const paramMub=(code,reg)=>{const r=typeof CodigosMubisys!=='undefined'?CodigosMubisys.rotulo(code,reg):'';return r?' · '+esc(r):'';};
const paramNoSimples=c=>[PARAM_DAS,PARAM_DARF].some(p=>c===p||c.startsWith(p+'.'));
const paramForaDoDas=c=>c.startsWith(PARAM_IMPOSTOS+'.')&&!paramNoSimples(c);
// Pago no Simples do mês (DAS + DARF), para tirar do total da conta 2.4.
const paramSimplesPago=reg=>(F.valorConta(reg,PARAM_DAS)||0)+(F.valorConta(reg,PARAM_DARF)||0);
const paramOrdemCodigo=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]??-1)-(y[i]??-1);if(d)return d;}return 0;};
function paramItemTributo(code,cad){
 const nome=paramNomeConta(code),pai=code.split('.').length>3?paramNomeConta(code.split('.').slice(0,-1).join('.')):null,rotulo=pai&&pai!==code?`${pai} · ${nome}`:nome;
 // sugestões tiradas do nome da conta (só preenchem o formulário; gravar é decisão)
 const sugestao={empresa:/impresilk/i.test(nome)?'impresilk':/universo/i.test(nome)?'universo':'',local:/iptu/i.test(pai||'')?nome:''};
 return {code,nome,rotulo,sugestao,cadastro:cad[code]||null};
}
// Linhas da tabela: as folhas da conta 2.4 fora do Simples e os cadastros de contas
// que ainda são folha. Cadastro numa conta que ganhou subcontas vira órfão:
// aparece à parte e não soma, para não contar o mesmo dinheiro duas vezes.
function paramContasTributos(){
 const codes=new Set();for(const r of state.records)for(const c of r.cells||[])if(paramForaDoDas(c.code))codes.add(c.code);
 const temFilha=c=>[...codes].some(o=>o.startsWith(c+'.'));
 const folhas=[...codes].filter(c=>!temFilha(c));
 const cad=paramCfg().tributos||{};for(const k of Object.keys(cad))if(!folhas.includes(k)&&paramForaDoDas(k)&&!temFilha(k))folhas.push(k);
 return folhas.sort(paramOrdemCodigo).map(code=>paramItemTributo(code,cad));
}
function paramTributosOrfaos(){
 const codes=new Set();for(const r of state.records)for(const c of r.cells||[])if(paramForaDoDas(c.code))codes.add(c.code);
 const cad=paramCfg().tributos||{};
 // também o cadastro de conta que passou para o Simples (DAS e DARF): não soma, mas não some
 return Object.keys(cad).filter(k=>paramNoSimples(k)||[...codes].some(o=>o.startsWith(k+'.'))).sort(paramOrdemCodigo).map(code=>({...paramItemTributo(code,cad),noSimples:paramNoSimples(code),filhas:[...codes].filter(o=>o.startsWith(code+'.')).sort(paramOrdemCodigo)}));
}
function paramLocalDoItem(t){
 const c=t.cadastro;if(c?.local)return {texto:c.local,origem:'cadastro'};
 const emp=c?.empresa||t.sugestao.empresa,sede=paramCfg().empresas?.[emp]?.sede;
 if(t.sugestao.local)return {texto:t.sugestao.local,origem:'sugestao'};
 if(sede)return {texto:sede,origem:'sede'};
 return {texto:'',origem:'vazio'};
}
const paramNomeEmpresa=id=>id==='ambas'?'As duas':PARAM_EMPRESAS.find(e=>e.id===id)?.nome||'';
// Situação de um item no mês, comparando o pago com o cadastro. Só "Mensal"
// acusa falta de pagamento: carnê anual ou eventual não paga todo mês.
function paramSituacao(t,pago){
 if(pago.estado==='sem-mes')return {texto:'Mês sem dados',classe:'neutra'};
 if(pago.valor<0)return {texto:'Estorno no mês',classe:'neutra'};
 if(!t.cadastro){if(pago.valor>0)return {texto:pago.parcial?'Pago até agora · sem cadastro':'Pago · sem cadastro',classe:'neutra'};return {texto:pago.parcial?'Mês em andamento · sem cadastro':'Sem cadastro',classe:'neutra'};}
 const c=t.cadastro,prev=paramNum(c.previsto)?Number(c.previsto):null;
 if(pago.valor>0){if(prev&&!pago.parcial&&Math.abs(pago.valor-prev)>prev*.1)return {texto:'Pago diferente do previsto',classe:'atencao'};return {texto:pago.parcial?'Pago até agora':'Pago',classe:'ok'};}
 if(pago.parcial)return {texto:'Mês em andamento',classe:'neutra'};
 if(c.recorrencia==='Mensal')return {texto:'Sem pagamento no mês',classe:'atencao'};
 return {texto:'Sem pagamento no mês',classe:'neutra'};
}

// ── validação dos formulários ───────────────────────────────────────────
function paramLerNumero(v,rotulo,{min=-Infinity,max=Infinity,inteiro=false,casas=2}={}){
 const n=paramNumeroBR(v);if(n==null)return null;
 if(!Number.isFinite(n))throw new Error(`${rotulo}: número não reconhecido. Use, por exemplo, 1.200.000,00 ou 7,45.`);
 if(n<min||n>max)throw new Error(`${rotulo}: valor fora do intervalo aceito (${min.toLocaleString('pt-BR')} a ${max.toLocaleString('pt-BR')}).`);
 if(inteiro&&!Number.isInteger(n))throw new Error(`${rotulo}: use número inteiro.`);
 if(Math.abs(n*10**casas-Math.round(n*10**casas))>1e-6)throw new Error(`${rotulo}: no máximo ${casas} casas depois da vírgula.`);
 return n;
}
const paramVazio=o=>Object.values(o).every(v=>v==null||v==='');
function paramValidarSimples(d){
 const anexo=String(d.anexo??'').trim();if(anexo&&!PARAM_ANEXOS.includes(anexo))throw new Error('Anexo: escolha de I a V.');
 const v={anexo:anexo||null,rbt12:paramLerNumero(d.rbt12,'RBT12',{min:0,max:1e10}),aliquota:paramLerNumero(d.aliquota,'Alíquota efetiva',{min:0,max:100,casas:4}),folha12:['III','V'].includes(anexo)?paramLerNumero(d.folha12,'Folha de 12 meses',{min:0,max:1e10}):null};
 return paramVazio(v)?null:v;
}
// Avisos condicionais: o enquadramento se mede pela receita do ano-calendário,
// e quem decide é a contabilidade. O sistema só aponta o que conferir.
function paramAvisosSimples(v){
 const a=[];if(!v)return a;
 if(v.rbt12>PARAM_TETO)a.push('RBT12 acima de R$ 4,8 milhões, o teto do Simples. O limite se mede pela receita do ano-calendário: confira o enquadramento com a contabilidade.');
 else if(v.rbt12>PARAM_SUBLIMITE)a.push('RBT12 acima de R$ 3,6 milhões, o sublimite do ICMS e do ISS. Se a receita do ano passar desse valor, ICMS e ISS deixam de ser pagos no DAS: confira com a contabilidade.');
 if(v.aliquota>33)a.push('Alíquota efetiva acima de 33%: confira no extrato do PGDAS-D.');
 const f=paramFatorR(v);if(f!=null)a.push(`Fator R ${paramFatorRTexto(f)}: se a atividade estiver sujeita ao Fator R, ${f>=PARAM_FATOR_R?'28% ou mais leva ao Anexo III':'abaixo de 28% leva ao Anexo V'}.`);
 return a;
}
// As duas juntas: com sócio em comum, o teto vale para a soma das receitas.
function paramAvisoConsolidado(label){
 const r=PARAM_EMPRESAS.map(e=>paramSimples(e.id,label)?.rbt12);if(!r.every(paramNum))return '';
 const soma=r.reduce((s,x)=>s+Number(x),0);
 return soma>PARAM_TETO?`Impresilk e Universo somam ${money(soma)} de RBT12. Se as duas tiverem sócio em comum, o limite de R$ 4,8 milhões vale para a soma das receitas (LC 123, art. 3º, §4º): confira com a contabilidade.`:'';
}
function paramValidarOperacao(d){
 const v={prazoRecebimento:paramLerNumero(d.prazoRecebimento,'Prazo de recebimento',{min:0,max:365,inteiro:true}),prazoPagamento:paramLerNumero(d.prazoPagamento,'Prazo de pagamento',{min:0,max:365,inteiro:true}),
  estoque:paramLerNumero(d.estoque,'Estoque',{min:0,max:1e10}),saldoInicial:paramLerNumero(d.saldoInicial,'Saldo bancário',{min:-1e10,max:1e10}),
  metaReceita:paramLerNumero(d.metaReceita,'Meta de receita',{min:0,max:1e10}),metaResultado:paramLerNumero(d.metaResultado,'Meta de resultado',{min:-1e10,max:1e10}),pdd90:paramLerNumero(d.pdd90,'Provisão acima de 90 dias',{min:0,max:100,casas:4})};
 return paramVazio(v)?null:v;
}
function paramValidarTributo(d){
 const empresa=String(d.empresa??'');if(empresa&&!['impresilk','universo','ambas'].includes(empresa))throw new Error('Empresa inválida.');
 const recorrencia=String(d.recorrencia??'');if(recorrencia&&!PARAM_RECORRENCIAS.includes(recorrencia))throw new Error('Recorrência inválida.');
 const v={local:String(d.local??'').trim().slice(0,120)||null,empresa:empresa||null,recorrencia:recorrencia||null,vencimento:paramLerNumero(d.vencimento,'Dia de vencimento',{min:1,max:31,inteiro:true}),
  previsto:paramLerNumero(d.previsto,'Valor previsto',{min:0,max:1e9}),observacao:String(d.observacao??'').trim().slice(0,300)||null};
 return paramVazio(v)?null:v;
}
function paramValidarEmpresa(d){
 const digitos=String(d.cnpj??'').replace(/\D/g,'');if(digitos&&!paramCnpjValido(digitos))throw new Error('CNPJ inválido: confira os 14 dígitos.');
 const v={cnpj:digitos||null,sede:String(d.sede??'').trim().slice(0,160)||null};return paramVazio(v)?null:v;
}

// ── gravação: relê a nuvem, compara e troca só o pedaço editado ─────────
let parametrosSalvando=false;
const paramLerCaminho=(obj,caminho)=>caminho.reduce((o,k)=>o?.[k],obj)??null;
function paramGravarCaminho(obj,caminho,valor){
 const [k,...resto]=caminho,copia={...(obj||{})};
 if(!resto.length){if(valor==null)delete copia[k];else copia[k]=valor;return copia;}
 const filho=paramGravarCaminho(obj?.[k],resto,valor);if(!Object.keys(filho).length)delete copia[k];else copia[k]=filho;return copia;
}
const paramComHistorico=(base,entrada)=>[...(base?.historico||[]),entrada].slice(-PARAM_HISTORICO_MAX);
async function paramApi(acao,payload){
 try{return await api(acao,payload);}
 catch(e){throw new Error(e?.name==='AbortError'?'A nuvem não respondeu a tempo. Recarregue a tela e confira se a gravação entrou antes de tentar de novo.':'Sem conexão com a nuvem: '+(e?.message||'tente novamente.'));}
}
// original = o valor que estava no cadastro quando a pessoa começou a editar
// (gravado no formulário ao desenhar), não o de agora: se outro administrador
// mudou depois, a gravação é recusada em vez de apagar a mudança dele.
async function salvarParametros(caminho,valor,original){
 if(!state.permissoes.admin)throw new Error('É necessário acesso administrativo para salvar parâmetros.');
 if(parametrosSalvando)throw new Error('Aguarde a gravação em andamento.');
 const sessao=STORE_KEY;parametrosSalvando=true;
 try{
  const r=await paramApi('getCfg');if(!r?.ok)throw new Error('Não foi possível ler a versão compartilhada.');
  const base=r.cfg?.parametros||{},atual=paramLerCaminho(base,caminho);
  if(!paramIgual(atual,original)){const e=new Error('Este cadastro mudou na nuvem depois que você começou a editar.');e.conflito={atual};throw e;}
  const em=new Date().toISOString(),novo=valor==null?null:{...valor,revisadoEm:em};
  const parametros={...paramGravarCaminho(base,caminho,novo),versao:1,historico:paramComHistorico(base,{em,caminho,anterior:atual,novo})};
  const cfg={...r.cfg,parametros};
  const saved=await paramApi('setCfg',{cfg,baseAtualizadoEm:r.atualizadoEm||null});
  if(!saved?.ok)throw new Error(saved?.conflito?'Os parâmetros mudaram durante a gravação. Sua edição continua aberta.':'Gravação não confirmada: '+(saved?.erro||'tente novamente.'));
  if(sessao!==STORE_KEY)throw new Error('O acesso mudou. Entre novamente para conferir a gravação.');
  state.cfg=cfg;state.cfgVersion=saved.atualizadoEm;return novo;
 }finally{parametrosSalvando=false;}
}
// Recuperar backup: os parâmetros voltam, mas o histórico de agora fica e
// ganha o registro da recuperação (a trilha nunca é reescrita).
function paramPrepararRestauracao(cfgBackup,cfgAtual,exportadoEm){
 if(!cfgBackup?.parametros)return cfgBackup;
 const em=new Date().toISOString();
 return {...cfgBackup,parametros:{...cfgBackup.parametros,historico:paramComHistorico(cfgAtual?.parametros,{em,caminho:['restauracao'],anterior:null,novo:{backup:exportadoEm||'sem data'}})}};
}

// ── rascunhos: o que foi digitado e não salvo sobrevive ao redesenho ─────
// (salvar outro quadro, trocar de mês ou a releitura automática da nuvem
// redesenham a tela). Ficam só nesta aba, até salvar ou descartar.
const paramRascunhos=new Map();
const paramChave=(tipo,{empresa='',mes='',conta=''}={})=>[tipo,empresa,mes,conta].join('|');
const paramChaveForm=f=>paramChave(f.dataset.paramForm,{empresa:f.dataset.empresa||'',mes:f.dataset.mes||'',conta:f.dataset.conta||''});
function paramRegistrarRascunho(form){
 const k=paramChaveForm(form);let r=paramRascunhos.get(k);
 if(!r){let original=null;try{original=JSON.parse(form.dataset.original||'null');}catch(_){}r={original,campos:{}};paramRascunhos.set(k,r);}
 for(const el of form.elements)if(el.name&&!el.disabled)r.campos[el.name]=el.value;
 form.classList.add('param-sujo');const aviso=form.querySelector('.param-pendente');if(aviso)aviso.hidden=false;
}
// Atributos do formulário: chave, original para o conflito e aviso de pendente.
function paramFormAttrs(tipo,ids,salvo){
 const r=paramRascunhos.get(paramChave(tipo,ids));
 return {r,attrs:`data-param-form="${tipo}"${ids.empresa?` data-empresa="${esc(ids.empresa)}"`:''}${ids.mes?` data-mes="${esc(ids.mes)}"`:''}${ids.conta?` data-conta="${esc(ids.conta)}"`:''} data-original="${esc(JSON.stringify(r?r.original:salvo??null))}"`,
  pendente:`<p class="param-pendente" role="status"${r?'':' hidden'}>Alterações não salvas neste quadro. <button type="button" class="link-cadastro" data-param-descartar>Descartar</button></p>`};
}
const paramValorCampo=(r,nome,salvo)=>r&&nome in r.campos?r.campos[nome]:paramParaCampo(nome,salvo);

// ── tela ────────────────────────────────────────────────────────────────
function paramMetric(rotulo,valor,nota,{tom='',chip=''}={}){
 return `<div class="metric metric-param"><span class="label">${esc(rotulo)}</span><strong class="${tom}">${esc(valor)}</strong><small>${esc(nota)}</small>${chip}</div>`;
}
const paramChipPadrao=`<span class="origem-dado origem-padrao">Padrão provisório · trocar pelo PGDAS-D</span>`;
const paramChipConferir=`<span class="origem-dado origem-padrao">A conferir no Plano de contas</span>`;
// Painel de gráfico dentro de um bloco: título h3 (o bloco já é h2).
function paramPainel(titulo,descricao,html,classe=''){
 return `<section class="chart-card param-grafico ${classe}"><div class="chart-heading"><div><h3>${esc(titulo)}</h3><p>${esc(descricao)}</p></div></div>${html}</section>`;
}
function paramCards(label){
 const ant=paramMesDesloca(label,-1);
 const aliq=PARAM_EMPRESAS.map(e=>{const p=paramSimples(e.id,label),a=paramAliquota(e.id,label);return paramMetric(`Alíquota efetiva · ${e.nome}`,paramPct(a.valor,4),`Competência ${label}${p?.anexo?' · Anexo '+p.anexo:''}`,{chip:a.origem==='padrao'?paramChipPadrao:''});});
 const d=paramDasMes(label);let das,notaDas,chipDas='',tomDas='';
 if(!d){das='Não apurado';notaDas=`${label} ainda sem dados coletados.`;}
 else{
  const conhecidas=PARAM_EMPRESAS.filter(e=>d.guias[e.id]!=null),soma=conhecidas.reduce((s,e)=>s+d.guias[e.id],0);
  das=!conhecidas.length&&d.resto?'A conferir':soma?money(soma):'Sem guia no mês';
  notaDas=`DAS e DARF da competência ${ant}${d.parcial?`, coletados até ${paramDiaMes(d.ate)} (mês em andamento)`:''}. Parcelamento à parte: ${d.parc?money(d.parc):'sem parcela no mês'}.${d.resto?` ${money(d.resto)} lançados no DAS e no DARF fora das subcontas da Impresilk e da Universo.`:''}`;
  if(d.resto)chipDas=paramChipConferir;
  if(conhecidas.length||!d.resto)tomDas=paramTom(soma);
 }
 const m=paramMesInfo(label),tot=m?F.valorConta(m.reg,PARAM_IMPOSTOS):null,fora=m?(tot==null?0:Math.round((tot-paramSimplesPago(m.reg))*100)/100):null;
 const notaFora=fora==null?`${label} ainda sem dados coletados.`:`IPTU, taxas, ICMS e DIFAL das compras, IOF e ISSQN (conta 2.4 sem o DAS e o DARF)${m.parcial?`, coletados até ${paramDiaMes(m.ate)} (mês em andamento)`:''}.`;
 return `<div class="cards cards-controle">${aliq.join('')}${paramMetric(`Simples pago em ${label}`,das,notaDas,{tom:tomDas,chip:chipDas})}${paramMetric(`Impostos e taxas fora do Simples · ${label}`,fora==null?'Não apurado':fora?money(fora):'Sem lançamento',notaFora,{tom:paramTom(fora)})}</div>`;
}
function paramCampo(nome,rotulo,valor,{dica='',inteiro=false}={},bloqueado){
 const num=!!PARAM_FORMATO[nome];
 return `<label>${esc(rotulo)}${dica?`<small>${esc(dica)}</small>`:''}<input name="${nome}" type="text"${num?` inputmode="${inteiro?'numeric':'decimal'}" autocomplete="off"`:''} value="${esc(valor??'')}"${bloqueado?' disabled':''}></label>`;
}
function paramRevisado(item){return item?.revisadoEm?`Revisado em ${dataBR(item.revisadoEm)}`:'Ainda sem cadastro neste mês';}
function paramGuiaHtml(e,seg){
 const d=paramDasMes(seg);if(!d)return esc(`${seg} ainda sem dados: a guia desta competência vence no mês seguinte.`);
 const v=d.guias[e.id];
 if(v==null&&d.resto)return esc(`Não apurado: ${money(d.resto)} do DAS e do DARF de ${seg} estão fora das subcontas conhecidas. Confira no Plano de contas.`);
 // com valor fora das subcontas, o da empresa não é o total: diz o que falta conferir
 if(v)return `<span class="${paramTom(v)}">${esc(money(v))}</span> ${esc(`${v<0?'estornados':'pagos'} em ${seg}${d.parcial?`, até ${paramDiaMes(d.ate)} (mês em andamento)`:''}${d.resto?`; mais ${money(d.resto)} no DAS e no DARF fora das subcontas, a conferir`:''}.`)}`;
 return esc(d.parcial?`${seg} em andamento: guia ainda não paga até ${paramDiaMes(d.ate)}.`:`Nenhuma guia lançada em ${seg} nas contas ${e.das} (DAS) e ${e.darf} (DARF).`);
}
function paramBlocoEmpresa(e,label,admin){
 const p=paramSimples(e.id,label),a=paramAliquota(e.id,label),ant=paramMesDesloca(label,-1),pAnt=paramSimples(e.id,ant),seg=paramMesDesloca(label,1);
 const fr=paramFatorR(p),cad=paramCfg().empresas?.[e.id]||null,avisos=paramAvisosSimples(p);
 const fs=paramFormAttrs('simples',{empresa:e.id,mes:label},p),fe=paramFormAttrs('empresa',{empresa:e.id},cad);
 const anexoAtual=fs.r&&'anexo' in fs.r.campos?fs.r.campos.anexo:p?.anexo||'',folhaAtiva=['III','V'].includes(anexoAtual);
 const v=(nome)=>paramValorCampo(fs.r,nome,p?.[nome]);
 return `<section class="param-empresa" aria-labelledby="pe-${e.id}"><header><h3 id="pe-${e.id}">${esc(e.nome)}</h3><span class="param-revisado">${esc(paramRevisado(p))}</span></header>
 <dl class="param-resumo"><div><dt>Alíquota efetiva</dt><dd>${esc(paramPct(a.valor,4))}${a.origem==='padrao'?` ${paramChipPadrao}`:''}</dd></div><div><dt>RBT12</dt><dd>${esc(paramNum(p?.rbt12)?money(p.rbt12):'Não apurado')}${paramNum(p?.rbt12)?` <small>${esc(paramPct(p.rbt12/PARAM_TETO*100,0))} do teto</small>`:''}</dd></div>${['III','V'].includes(p?.anexo)?`<div><dt>Fator R</dt><dd>${esc(paramFatorRTexto(fr))}</dd></div>`:''}<div><dt>Guia desta competência</dt><dd>${paramGuiaHtml(e,seg)}</dd></div></dl>
 ${avisos.length?`<ul class="param-avisos">${avisos.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:''}
 <form class="param-form" ${fs.attrs} novalidate>
  <div class="form-grid"><label>Anexo<select name="anexo"${admin?'':' disabled'}><option value="">Não informado</option>${PARAM_ANEXOS.map(x=>`<option ${anexoAtual===x?'selected':''}>${x}</option>`).join('')}</select></label>
  ${paramCampo('rbt12','RBT12 (R$)',v('rbt12'),{dica:'Receita bruta dos 12 meses anteriores'},!admin)}
  ${paramCampo('aliquota','Alíquota efetiva (%)',v('aliquota'),{dica:`Do extrato do PGDAS-D. Vazio: padrão provisório de ${paramPct(PARAM_ALIQUOTA_PADRAO)}`},!admin)}
  ${paramCampo('folha12','Folha de 12 meses (R$)',v('folha12'),{dica:'Só Anexo III ou V. Sem retiradas: não há pró-labore'},!admin||!folhaAtiva)}</div>
  <p class="param-erro" role="alert"></p>${admin?fs.pendente:''}
  ${admin?`<div class="actions"><button class="primary" type="submit">Salvar ${esc(e.nome)} · ${esc(label)}</button>${pAnt?`<button type="button" data-param-copiar="simples" data-empresa="${e.id}">Trazer de ${esc(ant)}</button>`:''}</div>`:''}
 </form>
 <details class="param-cadastro-empresa" data-empresa="${e.id}"${fe.r?' open':''}><summary>CNPJ e sede</summary><form class="param-form" ${fe.attrs} novalidate><div class="form-grid">${paramCampo('cnpj','CNPJ',fe.r&&'cnpj' in fe.r.campos?fe.r.campos.cnpj:paramCnpjFmt(cad?.cnpj),{},!admin)}${paramCampo('sede','Sede (endereço, município e UF)',paramValorCampo(fe.r,'sede',cad?.sede),{},!admin)}</div><p class="param-erro" role="alert"></p>${admin?fe.pendente:''}${admin?`<div class="actions"><button type="submit">Salvar CNPJ e sede</button></div>`:''}</form></details>
 </section>`;
}
function paramGraficosSimples(label){
 const meses=paramMesesDoAno(label),sel=meses.indexOf(label),ano=label.split('/')[1];
 // Só as guias do DAS (saída, em vermelho). O parcelamento é dívida e não entra;
 // o que estiver no DAS fora das subcontas aparece como série própria.
 const dados=meses.map(m=>({m,d:paramDasMes(m)})),comResto=dados.some(x=>x.d?.resto);
 const series=[...PARAM_EMPRESAS.map(e=>({chave:e.id,rotulo:e.nome})),...(comResto?[{chave:'resto',rotulo:'Sem subconta'}]:[])];
 const dasMeses=dados.map(({m,d})=>{const v={};for(const s of series)v[s.chave]=!d||d.parcial?null:s.chave==='resto'?d.resto:(d.guias[s.chave]??0);return {rotulo:m.slice(0,3),valores:v,linha:null};});
 const das=paramPainel('Quanto foi para o Simples em cada mês?',`DAS e DARF pagos em ${ano}, pelo mês do pagamento (cada guia é da competência anterior). O parcelamento é dívida e fica de fora. Mês sem dados ou em andamento fica hachurado.`,gEmpilhadas(dasMeses,{series,selecionado:sel,titulo:'Simples pago por mês (DAS e DARF)'}),'param-das');
 const linhas=PARAM_EMPRESAS.map(e=>`<div class="param-aliq"><h4>${esc(e.nome)}</h4>${gLinhaArea(meses.map(m=>{const p=paramSimples(e.id,m);return {rotulo:m.slice(0,3),valor:paramNum(p?.aliquota)?Number(p.aliquota):null};}),{selecionado:sel,titulo:`Alíquota efetiva da ${e.nome}`,formato:v=>paramPct(v,4),rotulo:'Alíquota',cor:'marca'})}</div>`).join('');
 const aliq=paramPainel('A alíquota efetiva está subindo?',`Só os meses informados do extrato do PGDAS-D. O padrão provisório (${paramPct(PARAM_ALIQUOTA_PADRAO)}) não entra no gráfico.`,`<div class="param-aliq-grade">${linhas}</div>`);
 return `<div class="graficos-controle">${das}${aliq}</div>`;
}
function paramBlocoTributos(label,admin){
 const itens=paramContasTributos().map(t=>({...t,pago:paramPago(label,t.code)})),orfaos=paramTributosOrfaos(),regMes=paramMesInfo(label)?.reg||null;
 const m=paramMesInfo(label),tot=m?F.valorConta(m.reg,PARAM_IMPOSTOS):null,fora=m?(tot==null?0:Math.round((tot-paramSimplesPago(m.reg))*100)/100):null;
 const soma=Math.round(itens.reduce((s,t)=>s+(t.pago.valor||0),0)*100)/100,dif=fora!=null?Math.round((fora-soma)*100)/100:0;
 const ate=m?.parcial?` até ${paramDiaMes(m.ate)} (mês em andamento)`:'';
 const barras=itens.filter(t=>t.pago.valor).map(t=>({rotulo:t.rotulo,valor:t.pago.valor}));if(Math.abs(dif)>=.01)barras.push({rotulo:'Sem subconta específica',valor:dif});
 const grafico=paramPainel('Onde estão os impostos e taxas do mês?',`Pagos em ${label}${ate}, fora do Simples, do maior para o menor.`,!m?GX.aviso('barras',`Não apurado: ${label} ainda sem dados coletados.`):barras.length?gBarrasOrdenadas(barras,{cor:'saida',limite:8,titulo:`Impostos e taxas pagos em ${label}${ate}`}):GX.aviso('barras',`Nenhum imposto ou taxa fora do Simples lançado em ${label}${ate}.`));
 const linhas=itens.map(t=>({...t,local:paramLocalDoItem(t),sit:paramSituacao(t,t.pago)})).sort((a,b)=>(a.local.texto?0:1)-(b.local.texto?0:1)||a.local.texto.localeCompare(b.local.texto,'pt-BR')||paramOrdemCodigo(a.code,b.code));
 const locais=[...new Set(linhas.map(t=>t.local.texto).filter(Boolean))];
 const celulaLocal=l=>l.texto?`${esc(l.texto)}${l.origem==='sugestao'?' <small class="param-sugestao">pelo nome da conta</small>':l.origem==='sede'?' <small class="param-sugestao">sede</small>':''}`:'<span class="nao-apurado">Sem local</span>';
 const pagoTxt=p=>p.estado==='sem-mes'?'Não apurado':p.valor?money(p.valor):'Sem lançamento';
 const tabela=`<div class="table-scroll"><table class="tabela-controle tabela-tributos"><caption>Impostos e taxas por local · ${esc(label)}${esc(ate)}</caption><thead><tr><th scope="col">Imposto ou taxa</th><th scope="col">Local</th><th scope="col">Empresa</th><th scope="col">Recorrência</th><th scope="col" class="num">Vence dia</th><th scope="col" class="num">Previsto</th><th scope="col" class="num">Pago no mês</th><th scope="col">Situação</th>${admin?'<th scope="col"><span class="sr-only">Editar</span></th>':''}</tr></thead><tbody>${linhas.map(t=>{const c=t.cadastro||{};return `<tr><th scope="row">${esc(t.rotulo)} <small class="param-conta">${esc(t.code)}${paramMub(t.code,regMes)}</small></th><td>${celulaLocal(t.local)}</td><td>${esc(paramNomeEmpresa(c.empresa||'')||'—')}</td><td>${esc(c.recorrencia||'—')}</td><td class="num">${esc(paramNum(c.vencimento)?String(c.vencimento):'—')}</td><td class="num">${esc(paramNum(c.previsto)?money(c.previsto):'—')}</td><td class="num ${paramTom(t.pago.valor)}">${esc(pagoTxt(t.pago))}</td><td><span class="param-sit sit-${t.sit.classe}">${esc(t.sit.texto)}</span></td>${admin?`<td><button type="button" class="link-cadastro" data-param-tributo="${esc(t.code)}" aria-label="${esc('Editar '+t.rotulo)}">Editar</button></td>`:''}</tr>`;}).join('')}${Math.abs(dif)>=.01?`<tr><th scope="row">Sem subconta específica</th><td colspan="5">Diferença entre o total da conta 2.4 (sem o DAS e o DARF) e a soma dos itens.</td><td class="num ${paramTom(dif)}">${esc(money(dif))}</td><td></td>${admin?'<td></td>':''}</tr>`:''}</tbody>${m?`<tfoot><tr><th scope="row">Total fora do Simples${esc(ate)}</th><td colspan="5"></td><td class="num ${paramTom(fora)}">${esc(fora?money(fora):'Sem lançamento')}</td><td colspan="${admin?2:1}"></td></tr></tfoot>`:''}</table></div>`;
 const orfaosHtml=orfaos.length?`<div class="param-avisos param-orfaos"><p><b>Cadastro sem uso:</b> a conta ganhou subcontas (o valor agora é lançado nelas) ou passou para o quadro do Simples. Copie o que precisar e apague o cadastro antigo.</p><ul>${orfaos.map(o=>`<li>${esc(o.rotulo)} <small class="param-conta">${esc(o.code)}${paramMub(o.code,regMes)}</small> → ${esc(o.noSimples?'agora no quadro do Simples (DAS e DARF)':o.filhas.join(', '))}${admin?` <button type="button" class="link-cadastro" data-param-tributo="${esc(o.code)}" aria-label="${esc('Editar o cadastro antigo de '+o.rotulo)}">Editar</button>`:''}</li>`).join('')}</ul></div>`:'';
 return `<section class="param-bloco" aria-labelledby="param-tributos-titulo"><div class="param-bloco-topo"><h2 id="param-tributos-titulo" tabindex="-1">Impostos e taxas por local</h2><p>Tudo o que se paga fora do Simples, local por local: IPTU de cada imóvel, taxas de cada empresa, ICMS e DIFAL das compras, IOF e ISSQN. As linhas vêm do plano de contas (2.4); o cadastro diz onde, de quem, quando vence e quanto se espera pagar. O ICMS e o DIFAL das compras em outros estados são pagos na conta 2.4.2: informe no local a UF de origem das compras. O DAS e o DARF do PGDAS ficam no quadro do Simples. Ao lado de cada código do painel vai o código da mesma conta no Mubisys.</p>${locais.length?`<p class="param-locais"><b>${locais.length} ${locais.length===1?'local':'locais'}:</b> ${locais.map(esc).join(' · ')}</p>`:''}</div>${grafico}${linhas.length?tabela:'<p class="hint">Nenhuma conta de imposto fora do Simples nos meses coletados.</p>'}${orfaosHtml}</section>`;
}
function paramBlocoOperacao(label,admin){
 const o=paramOperacao(label),ant=paramMesDesloca(label,-1),oAnt=paramOperacao(ant),fo=paramFormAttrs('operacao',{mes:label},o);
 const c=(nome,rotulo,op={})=>paramCampo(nome,rotulo,paramValorCampo(fo.r,nome,o?.[nome]),op,!admin);
 return `<section class="param-bloco" aria-labelledby="param-operacao-titulo"><div class="param-bloco-topo"><h2 id="param-operacao-titulo">Prazos, estoque e metas · ${esc(label)}</h2><p>As duas empresas juntas, como o caixa. Alimentam capital de giro, recebíveis e o fluxo de caixa nas próximas fases. ${esc(paramRevisado(o))}.</p></div>
 <form class="param-form" ${fo.attrs} novalidate><div class="form-grid param-grade-3">
 ${c('prazoRecebimento','Prazo médio de recebimento concedido (dias)',{inteiro:true})}${c('prazoPagamento','Prazo médio de pagamento negociado (dias)',{inteiro:true})}${c('estoque','Estoque no fim do mês (R$)')}
 ${c('saldoInicial','Saldo bancário no início do mês (R$)',{dica:'Pode ser negativo'})}${c('metaReceita','Meta de receita do mês (R$)')}${c('metaResultado','Meta de resultado do mês (R$)')}
 ${c('pdd90','Provisão para vencidos há mais de 90 dias (%)')}</div><p class="param-erro" role="alert"></p>${admin?fo.pendente:''}
 ${admin?`<div class="actions"><button class="primary" type="submit">Salvar prazos, estoque e metas · ${esc(label)}</button>${oAnt?`<button type="button" data-param-copiar="operacao">Trazer de ${esc(ant)}</button>`:''}</div>`:''}</form></section>`;
}
function paramDescreveCaminho(c){
 const [secao,a,b]=c||[];
 if(secao==='simples')return `Simples · ${paramNomeEmpresa(b)||b} · ${paramMesLabel(a)}`;
 if(secao==='operacao')return `Prazos, estoque e metas · ${paramMesLabel(a)}`;
 if(secao==='tributos')return `Imposto ou taxa · ${paramNomeConta(a)} (${a})`;
 if(secao==='empresas')return `Empresa · ${paramNomeEmpresa(a)||a}`;
 if(secao==='restauracao')return 'Recuperação de backup';
 return (c||[]).join(' · ');
}
function paramFmtCampo(secao,k,v){
 if(v==null||v==='')return 'vazio';
 if(PARAM_FORMATO[k]==='moeda')return money(v);
 if(PARAM_FORMATO[k]==='pct')return paramPct(v,4);
 if(['prazoRecebimento','prazoPagamento'].includes(k))return paramDias(v);
 if(k==='empresa')return paramNomeEmpresa(v)||v;if(k==='cnpj')return paramCnpjFmt(v)||v;if(k==='backup')return /^\d{4}-/.test(v)?dataBR(v):String(v);
 return String(v);
}
function paramMudancas(h){
 const secao=h.caminho?.[0],nomes=PARAM_CAMPOS[secao]||{},a=h.anterior||{},n=h.novo||{};
 return [...new Set([...Object.keys(a),...Object.keys(n)])].filter(k=>k!=='revisadoEm'&&!paramIgual(a[k],n[k])).map(k=>`${nomes[k]||k}: ${paramFmtCampo(secao,k,a[k])} → ${paramFmtCampo(secao,k,n[k])}`);
}
function paramHistorico(){
 const todos=paramCfg().historico||[],h=[...todos].reverse().slice(0,60);
 const corpo=h.length?`<div class="table-scroll"><table class="tabela-controle"><thead><tr><th scope="col">O que mudou</th><th scope="col">Quando</th><th scope="col">Mudança</th></tr></thead><tbody>${h.map(x=>`<tr><th scope="row">${esc(paramDescreveCaminho(x.caminho))}</th><td>${esc(dataBR(x.em))}</td><td>${esc(paramMudancas(x).join('; ')||'sem diferença')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="hint">Nenhuma alteração gravada ainda.</p>';
 return card(`Histórico de alterações${h.length?` (${h.length}${todos.length>60?' mais recentes':''})`:''}`,corpo,false);
}
function renderParametros(){
 const label=state.periodo,admin=!!state.permissoes?.admin;
 if(!paramMesChave(label))return '<p class="hint">Escolha um mês para ver os parâmetros.</p>';
 const consolidado=paramAvisoConsolidado(label);
 return paramCards(label)
  +`${admin?'':'<p class="note">Somente administradores alteram parâmetros. Os valores abaixo são de consulta.</p>'}`
  +`<section class="param-bloco bloco-simples" aria-labelledby="param-simples-titulo"><div class="param-bloco-topo"><h2 id="param-simples-titulo">Simples Nacional · competência ${esc(label)}</h2><p>Impresilk e Universo, as duas no Simples, cada uma com seu CNPJ, anexo, RBT12 e alíquota. A alíquota muda todo mês: o cadastro guarda o histórico. O imposto de cada competência sai do PGDAS em duas contas por empresa, DAS (2.4.1.2 e 2.4.1.3) e DARF (2.4.3.1 e 2.4.3.2), e é pago no mês seguinte; o parcelamento (2.4.1.1) é dívida e fica de fora. A folha do Fator R não inclui retiradas: não há pró-labore. ICMS, DIFAL e os demais tributos fora do Simples ficam no quadro de impostos por local.</p>${consolidado?`<ul class="param-avisos"><li>${esc(consolidado)}</li></ul>`:''}</div><div class="param-empresas">${PARAM_EMPRESAS.map(e=>paramBlocoEmpresa(e,label,admin)).join('')}</div>${paramGraficosSimples(label)}</section>`
  +paramBlocoTributos(label,admin)+paramBlocoOperacao(label,admin)+paramHistorico();
}

// ── interação: delegação no documento (a tela é redesenhada a cada render) ──
function paramFormDados(form){return Object.fromEntries(new FormData(form));}
function paramPreencher(form,valores){for(const [k,v] of Object.entries(valores||{})){const el=form.elements.namedItem(k);if(!el||k==='revisadoEm')continue;el.value=k==='cnpj'?paramCnpjFmt(v):paramParaCampo(k,v);}}
function paramAtualizarFolha(form){const folha=form.elements.namedItem('folha12');if(folha)folha.disabled=!['III','V'].includes(form.elements.namedItem('anexo')?.value);}
function paramFocar(seletor,reserva){
 if(typeof document==='undefined'||typeof document.querySelector!=='function')return;
 const ir=()=>{const el=document.querySelector(seletor)||(reserva&&document.querySelector(reserva));el?.focus?.();};
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(ir);else ir();
}
function paramAbrirTributo(code){
 const t=paramContasTributos().find(x=>x.code===code)||paramTributosOrfaos().find(x=>x.code===code);if(!t)return;
 // Com cadastro, vale o que foi gravado (inclusive vazio); a sugestão pelo nome
 // da conta só preenche o que ainda não tem cadastro, e diz isso.
 const c=t.cadastro,sug=c?{}:{local:t.sugestao.local,empresa:t.sugestao.empresa};
 const v={local:c?c.local??'':sug.local,empresa:c?c.empresa??'':sug.empresa,recorrencia:c?.recorrencia||'',vencimento:paramParaCampo('vencimento',c?.vencimento),previsto:paramParaCampo('previsto',c?.previsto),observacao:c?.observacao||''};
 const sugeridos=[sug.local&&'o local',sug.empresa&&'a empresa'].filter(Boolean);
 const f=paramFormAttrs('tributo',{conta:code},c);
 dialog(`${t.rotulo} (${t.code})`,`<form class="param-form" ${f.attrs} novalidate>${sugeridos.length?`<p class="hint">${esc(sugeridos.join(' e ').replace(/^./,x=>x.toUpperCase()))} ${sugeridos.length>1?'vieram':'veio'} do nome da conta: confira antes de salvar.</p>`:''}<div class="form-grid">
 ${paramCampo('local','Local (imóvel, município ou UF de destino)',v.local)}
 <label>Empresa<select name="empresa"><option value="">Não informada</option>${[...PARAM_EMPRESAS.map(e=>[e.id,e.nome]),['ambas','As duas']].map(([id,n])=>`<option value="${id}" ${v.empresa===id?'selected':''}>${esc(n)}</option>`).join('')}</select></label>
 <label>Recorrência<select name="recorrencia"><option value="">Não informada</option>${PARAM_RECORRENCIAS.map(r=>`<option ${v.recorrencia===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label>
 ${paramCampo('vencimento','Dia de vencimento',v.vencimento,{inteiro:true})}${paramCampo('previsto','Valor previsto por guia (R$)',v.previsto)}
 </div>${paramCampo('observacao','Observação',v.observacao)}<p class="param-erro" role="alert"></p><div class="actions"><button class="primary" type="submit">Salvar</button>${c?'<button type="button" data-param-limpar="tributo">Apagar cadastro</button>':''}</div></form>`);
}
function paramDestinoFoco(tipo,form){
 if(tipo==='tributo')return [`button[data-param-tributo="${form.dataset.conta}"]`,'#param-tributos-titulo'];
 if(tipo==='empresa')return [`details.param-cadastro-empresa[data-empresa="${form.dataset.empresa}"]>summary`];
 return [`form[data-param-form="${tipo}"]${form.dataset.empresa?`[data-empresa="${form.dataset.empresa}"]`:''} button[type="submit"]`];
}
async function paramSalvarForm(form,limpar=false){
 const erro=form.querySelector('.param-erro'),botoes=[...form.querySelectorAll('button')];if(erro){erro.textContent='';erro.classList.remove('param-info');}
 const tipo=form.dataset.paramForm,dados=paramFormDados(form);
 let caminho,valor,msg;
 try{
  if(tipo==='simples'){const k=paramMesChave(form.dataset.mes);caminho=['simples',k,form.dataset.empresa];valor=paramValidarSimples(dados);msg=`Simples da ${paramNomeEmpresa(form.dataset.empresa)} em ${form.dataset.mes} salvo.`;}
  else if(tipo==='operacao'){caminho=['operacao',paramMesChave(form.dataset.mes)];valor=paramValidarOperacao(dados);msg=`Prazos, estoque e metas de ${form.dataset.mes} salvos.`;}
  else if(tipo==='tributo'){caminho=['tributos',form.dataset.conta];valor=limpar?null:paramValidarTributo(dados);msg=limpar?'Cadastro do imposto apagado.':'Imposto ou taxa salvo.';}
  else if(tipo==='empresa'){caminho=['empresas',form.dataset.empresa];valor=paramValidarEmpresa(dados);msg=`CNPJ e sede da ${paramNomeEmpresa(form.dataset.empresa)} salvos.`;}
  else return;
  if(caminho.some(x=>!x))throw new Error('Formulário sem mês ou sem conta: recarregue a tela.');
 }catch(e){if(erro)erro.textContent=e.message;form.querySelector('button[type="submit"]')?.focus?.();return;}
 let original=null;try{original=JSON.parse(form.dataset.original||'null');}catch(_){}
 const chave=paramChaveForm(form),[foco,reserva]=paramDestinoFoco(tipo,form);
 botoes.forEach(b=>b.disabled=true);
 try{
  await salvarParametros(caminho,valor,original);paramRascunhos.delete(chave);
  if(tipo==='tributo'&&$$('detailDialog')?.open)$$('detailDialog').close();
  toast(msg);render();paramFocar(foco,reserva);
 }catch(e){
  // O formulário pode ter saído da tela (troca de mês, releitura, diálogo fechado): o aviso vai para o toast.
  const naTela=form.isConnected!==false&&(tipo!=='tributo'||$$('detailDialog')?.open!==false);
  let texto=e.message;
  if(e.conflito){
   // Mostra o que a outra pessoa mudou e passa a comparar com o valor novo:
   // salvar de novo é uma decisão consciente de manter os próprios valores.
   const agora=e.conflito.atual??null,dif=paramMudancas({caminho,anterior:original,novo:agora});
   form.dataset.original=JSON.stringify(agora);const r=paramRascunhos.get(chave);if(r)r.original=agora;
   texto=`Outra pessoa mudou este cadastro na nuvem${dif.length?': '+dif.join('; '):''}. Confira; para manter os seus valores, salve de novo.`;
  }
  if(erro&&naTela)erro.textContent=texto;else toast(texto,'err');
  botoes.forEach(b=>b.disabled=false);if(naTela)form.querySelector('button[type="submit"]')?.focus?.();
 }
}
function wireParametros(){
 if(typeof document==='undefined'||typeof document.addEventListener!=='function')return;
 document.addEventListener('submit',e=>{const f=e.target?.closest?.('form[data-param-form]');if(!f)return;e.preventDefault();paramSalvarForm(f);});
 const anotar=e=>{const f=e.target?.closest?.('form[data-param-form]');if(!f||!e.target.name)return;if(e.target.name==='anexo')paramAtualizarFolha(f);if(f.dataset.paramForm!=='tributo')paramRegistrarRascunho(f);};
 document.addEventListener('input',anotar);document.addEventListener('change',anotar);
 document.addEventListener('click',e=>{
  const b=e.target?.closest?.('button');if(!b)return;
  if(b.dataset.paramTributo){paramAbrirTributo(b.dataset.paramTributo);return;}
  if(b.hasAttribute?.('data-param-descartar')){const f=b.closest('form[data-param-form]');if(f){paramRascunhos.delete(paramChaveForm(f));render();}return;}
  if(b.dataset.paramLimpar){const f=b.closest('form[data-param-form]');if(f&&confirm('Apagar o cadastro deste imposto? O histórico guarda o valor anterior.'))paramSalvarForm(f,true);return;}
  if(b.dataset.paramCopiar){const f=b.closest('form[data-param-form]'),ant=paramMesDesloca(f.dataset.mes,-1);const v=b.dataset.paramCopiar==='simples'?paramSimples(f.dataset.empresa,ant):paramOperacao(ant);paramPreencher(f,v);
   paramAtualizarFolha(f);paramRegistrarRascunho(f);
   const erro=f.querySelector('.param-erro');if(erro){erro.textContent=`Valores de ${ant} trazidos para conferência. Nada foi salvo ainda.`;erro.classList.add('param-info');}}
 });
}
if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('DOMContentLoaded',wireParametros);
