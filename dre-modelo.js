/* DRE por competência: rubricas informadas e revisadas, sem inferência a partir do caixa. */
var DREModelo=(()=>{
 const campos=[
  ['produtos','Receita de produtos','Receitas','Vendas reconhecidas no mês, mesmo que ainda não recebidas.'],
  ['servicos','Receita de serviços','Receitas','Serviços reconhecidos pela entrega ou execução aplicável.'],
  ['outrasVendas','Outras receitas de vendas','Receitas','Outras receitas da atividade principal. Não inclua empréstimos.'],
  ['devolucoes','Devoluções e cancelamentos','Deduções','Informe o valor da redução, como número positivo.'],
  ['descontos','Descontos incondicionais','Deduções','Descontos que reduzem o valor da venda.'],
  ['tributosVendas','Tributos sobre vendas','Deduções','No Simples: o DAS da competência e o ISS pago fora dele. ICMS e DIFAL das compras ficam nos custos.'],
  ['custos','Custo dos produtos e serviços vendidos','Operação','Materiais consumidos, mão de obra e demais custos correspondentes às vendas; não são todas as compras do mês.'],
  ['despesasVendas','Despesas com vendas','Operação','Comissões, divulgação e estrutura comercial do período.'],
  ['administrativas','Despesas administrativas','Operação','Despesas administrativas incorridas, pagas ou não.'],
  ['outrasDespesas','Outras despesas operacionais','Operação','Demais despesas do período que não constam nos campos anteriores.'],
  ['outrasReceitas','Outras receitas operacionais','Operação','Receitas operacionais fora das vendas, sem duplicar as rubricas anteriores.'],
  ['equivalencia','Resultado de equivalência patrimonial','Operação','Se aplicável, positivo para ganho e negativo para perda.',true],
  ['receitasFinanceiras','Receitas financeiras','Financeiro e tributos','Juros e rendimentos reconhecidos. Não inclua principal de empréstimos.'],
  ['despesasFinanceiras','Despesas financeiras','Financeiro e tributos','Juros e encargos do período; a amortização do principal fica fora.'],
  ['tributosLucro','IRPJ e CSLL correntes','Financeiro e tributos','No Simples Nacional, IRPJ e CSLL já estão dentro do DAS: deixe vazio. Preencha só se houver apuração fora do Simples.'],
  ['tributosDiferidos','IRPJ e CSLL diferidos','Financeiro e tributos','No Simples, deixe vazio. Fora dele: despesa positiva; benefício tributário negativo, conforme a apuração contábil.',true],
  ['descontinuadas','Resultado líquido de operações descontinuadas','Ajustes e informações','Se aplicável, já líquido dos tributos. Ganho positivo; perda negativa.',true],
  ['da','Depreciação e amortização incluídas acima','Ajustes e informações','Informação para calcular EBITDA. Este valor já deve integrar os custos e despesas acima: não será descontado novamente.']
 ].map(([id,nome,grupo,ajuda,assinado=false])=>({id,nome,grupo,ajuda,assinado}));
 const cent=v=>v==null||v===''||typeof v!=='number'||!Number.isFinite(v)?null:Math.round(v*100);
 function validar(valores){
  const clean={};for(const f of campos){const x=valores?.[f.id];if(x==null||x===''){clean[f.id]=null;continue;}if(typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e12)throw new Error('Valor inválido em '+f.nome);if(!f.assinado&&x<0)throw new Error('Informe valor positivo em '+f.nome);clean[f.id]=Math.round(x*100)/100;}return clean;
 }
 // As duas empresas são do Simples: IRPJ e CSLL estão dentro do DAS. Campo vazio
 // nessas duas linhas vale zero fora do DAS (o rótulo da linha diz isso); valor
 // informado continua valendo. Também não conta como rubrica pendente.
 const DENTRO_DO_DAS=['tributosLucro','tributosDiferidos'];
 const pendentes=(valores,regime='simples')=>campos.filter(c=>valores?.[c.id]==null&&!(regime==='simples'&&DENTRO_DO_DAS.includes(c.id)));
 function calcular(valores,{regime='simples'}={}){
  const v=validar(valores),out={...v};
  const calc=(id,parts)=>{const nums=parts.map(([key,sinal])=>[cent(out[key]),sinal]);out[id]=nums.some(([n])=>n==null)?null:nums.reduce((sum,[n,sinal])=>sum+n*sinal,0)/100;};
  calc('bruta',[['produtos',1],['servicos',1],['outrasVendas',1]]);
  calc('deducoes',[['devolucoes',1],['descontos',1],['tributosVendas',1]]);
  calc('liquida',[['bruta',1],['deducoes',-1]]);
  calc('bruto',[['liquida',1],['custos',-1]]);
  calc('operacional',[['bruto',1],['despesasVendas',-1],['administrativas',-1],['outrasDespesas',-1],['outrasReceitas',1],['equivalencia',1]]);
  calc('financeiro',[['receitasFinanceiras',1],['despesasFinanceiras',-1]]);
  calc('antesTributos',[['operacional',1],['financeiro',1]]);
  if(regime==='simples')for(const k of DENTRO_DO_DAS)if(out[k]==null)out[k]=0;
  calc('continuadas',[['antesTributos',1],['tributosLucro',-1],['tributosDiferidos',-1]]);
  calc('liquido',[['continuadas',1],['descontinuadas',1]]);
  calc('ebitda',[['operacional',1],['da',1]]);
  for(const [key,total] of [['margemBruta','bruto'],['margemOperacional','operacional'],['margemLiquida','liquido'],['margemEbitda','ebitda']])out[key]=out.liquida>0&&out[total]!=null?out[total]/out.liquida*100:null;
  return out;
 }
 const linhas=[
  ['bruta','Receita bruta','total','Receita bruta'],['produtos','Produtos','detail','Receita'],['servicos','Serviços','detail','Receita'],['outrasVendas','Outras vendas','detail','Receita'],
  ['deducoes','(−) Deduções da receita','normal','Deduções'],['devolucoes','Devoluções e cancelamentos','detail','Devoluções'],['descontos','Descontos incondicionais','detail','Desconto'],['tributosVendas','Tributos sobre vendas','detail','Tributos sobre vendas'],
  ['liquida','(=) Receita líquida','subtotal','Receita líquida'],['custos','(−) Custo dos produtos e serviços vendidos','normal','CPV / CMV / CSP'],['bruto','(=) Lucro bruto','subtotal','Lucro bruto'],['margemBruta','Margem bruta','ratio','Margem bruta'],
  ['despesasVendas','(−) Despesas com vendas','normal','Despesa operacional'],['administrativas','(−) Despesas administrativas','normal','Despesa administrativa'],['outrasDespesas','(−) Outras despesas operacionais','normal','Despesa operacional'],['outrasReceitas','(+) Outras receitas operacionais','normal','Receita'],['equivalencia','(+/−) Equivalência patrimonial','normal','Equivalência patrimonial'],
  ['operacional','(=) Resultado antes de financeiro e tributos','subtotal','EBIT / LAJIR'],['margemOperacional','Margem operacional','ratio','Margem operacional'],['receitasFinanceiras','(+) Receitas financeiras','normal','Receita financeira'],['despesasFinanceiras','(−) Despesas financeiras','normal','Despesa financeira'],['antesTributos','(=) Resultado antes dos tributos sobre o lucro','subtotal','LAIR'],['tributosLucro','(−) IRPJ e CSLL correntes · no Simples, dentro do DAS','normal','IRPJ e CSLL'],['tributosDiferidos','(−/+) IRPJ e CSLL diferidos · no Simples, dentro do DAS','normal','Tributo diferido'],['continuadas','(=) Resultado das operações continuadas','subtotal','Resultado líquido'],['descontinuadas','(+/−) Operações descontinuadas, líquido','normal','Operação descontinuada'],['liquido','(=) Lucro / prejuízo líquido','result','Resultado líquido'],['margemLiquida','Margem líquida','ratio','Margem líquida'],
  ['da','Depreciação e amortização já incluídas','info','Depreciação'],['ebitda','EBITDA / LAJIDA · operações continuadas','subtotal','EBITDA / LAJIDA'],['margemEbitda','Margem EBITDA','ratio','Margem EBITDA']
 ].map(([id,nome,tipo,termo])=>({id,nome,tipo,termo}));
 function acumulado(months){const keys=Object.keys(calcular({}));const out={};for(const key of keys.filter(k=>!k.startsWith('margem'))){const values=months.map(x=>calcular(x?.valores||{})[key]);out[key]=!values.length||values.some(v=>v==null)?null:values.reduce((sum,v)=>sum+Math.round(v*100),0)/100;}for(const [key,total] of [['margemBruta','bruto'],['margemOperacional','operacional'],['margemLiquida','liquido'],['margemEbitda','ebitda']])out[key]=out.liquida>0&&out[total]!=null?out[total]/out.liquida*100:null;return out;}
  return {campos,linhas,validar,calcular,acumulado,pendentes,DENTRO_DO_DAS};
})();

/* A competência usa um campo próprio da configuração existente, protegido pela
   versão da nuvem. Não cria nem substitui registros de recebimento/pagamento. */
var DRECompetencia=(()=>{
 const campo='demonstrativosCompetencia';
 const obter=(cfg,id)=>cfg?.[campo]?.meses?.[id]||null;
 // O jsonb devolve as chaves em outra ordem: compara com chaves ordenadas em
 // todos os níveis. A ordem dos itens de uma lista continua contando.
 const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
 const igual=(a,b)=>JSON.stringify(canon(a||null))===JSON.stringify(canon(b||null));
 async function salvar({api,admin,id,original,registro}){
  if(!admin)throw new Error('A gravação da competência exige acesso de administração.');
  if(!/^(Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)_\d{4}$/.test(id)||id!==registro.label.replace('/','_'))throw new Error('Período inválido.');
  if(!registro.company?.trim()||!registro.fonte?.trim()||!registro.revisao)throw new Error('Informe empresas, fonte e revisão.');
  const valores=DREModelo.validar(registro.valores);
  if(Object.values(valores).every(v=>v==null))throw new Error('Preencha ao menos uma rubrica.');
  const fresh=await api('getCfg');if(!fresh.ok)throw new Error('Não foi possível conferir a versão da nuvem.');
  const antigo=obter(fresh.cfg,id);
  // Resposta perdida: uma nova tentativa não duplica a revisão já confirmada.
  if(antigo?.revisao===registro.revisao)return fresh;
  if(!igual(antigo,original))throw new Error('Este mês mudou na nuvem. Sua edição foi preservada. Feche, leia a nuvem e confira a nova versão antes de editar novamente.');
  const area=fresh.cfg?.[campo]||{};
  if(area.versao&&area.versao!==1)throw new Error('Atualize o painel para editar esta versão do demonstrativo.');
  const historico=antigo?[{...antigo,historico:undefined},...(antigo.historico||[])].slice(0,3):[];
  const clean={label:registro.label,company:registro.company.trim(),fonte:registro.fonte.trim(),notas:String(registro.notas||'').slice(0,3000),basis:'competencia',valores,revisao:registro.revisao,revisadoEm:registro.revisadoEm,estado:DREModelo.pendentes(valores).length?'parcial':'preenchido',historico};
  const cfg={...fresh.cfg,[campo]:{...area,versao:1,meses:{...area.meses,[id]:clean}}};
  const res=await api('setCfg',{cfg,baseAtualizadoEm:fresh.atualizadoEm||null});
  if(!res.ok)throw new Error(res.conflito?'A base mudou durante a gravação. Tente salvar novamente para conferir a versão mais recente.':res.erro||'Gravação não confirmada. Sua edição continua aberta.');
  return {ok:true,cfg,atualizadoEm:res.atualizadoEm};
 }
 return {campo,obter,igual,salvar};
})();

/* DRE Simples gerencial, na base de caixa. Cada conta do plano cai numa linha
   da DRE pela regra mais específica (o próprio código ou o prefixo mais longo).
   O que a conta mãe tem além das filhas (resíduo) segue a regra da própria mãe,
   para nada sumir nem contar duas vezes. Percentual sempre sobre as VENDAS.
   Sócios, investimentos, dívidas e transferências não são despesa: ficam
   abaixo do resultado, e a soma de tudo fecha com a variação do caixa.
   "conferir" marca só o que é anomalia de verdade (alarme sempre aceso ensina
   a ignorar); dúvidas de classificação que valem todo mês vão em "nota". */
var DRESimples=(()=>{
 const R=(linha,conferir='',nota='')=>({linha,conferir,nota});
 const REGRAS={
  '1':R('foraOutras','Entrada sem linha na DRE'),
  '1.1':R('vendas'),'1.2':R('vendas'),'1.5':R('vendas'),'1.6':R('vendas'),
  '1.3':R('receitasFinanceiras'),'1.4':R('emprestimos'),'1.7':R('aIdentificar'),
  '2':R('fixasOutras','Saída sem linha na DRE'),
  '2.1':R('pessoal'),'2.1.12':R('variaveis','','Comissão acompanha a venda'),
  '2.2':R('administrativas'),'2.2.6':R('devolucoes'),
  '2.3':R('ocupacao'),
  '2.4':R('taxas','Imposto lançado sem subconta'),
  '2.4.1':R('das','DAS fora das subcontas da Impresilk e da Universo'),'2.4.1.1':R('dividas','','Parcelamento do DAS é dívida'),'2.4.1.2':R('das'),'2.4.1.3':R('das'),
  '2.4.2':R('variaveis','','ICMS e DIFAL das compras em outros estados: custo da compra'),'2.4.8':R('impostosVendas','','ISS pago fora do DAS'),
  '2.4.3':R('dividas','','DARF de parcelamento: é dívida, não despesa do mês'),
  '2.4.4':R('taxas'),'2.4.5':R('taxas'),'2.4.6':R('taxas'),'2.4.7':R('despesasFinanceiras'),
  '2.5':R('ocupacao'),
  '2.6':R('variaveis','','Manutenção e insumos das máquinas (tintas etc.): acompanham a produção'),'2.6.1':R('investimentos','','Compra de máquina é investimento'),
  '2.7':R('veiculos'),'2.7.1':R('investimentos','','Compra de veículo é investimento'),
  '2.8':R('administrativas'),'2.8.5':R('variaveis','','Comissão acompanha a venda'),
  '2.9':R('pessoal'),'2.10':R('variaveis'),'2.11':R('variaveis'),'2.12':R('variaveis','','Compras pagas no mês, não o custo do que foi vendido'),
  '2.12.11':R('marketing','Conta de marketing dentro de Materiais'),'2.12.12':R('marketing','Conta de marketing dentro de Materiais'),'2.12.51':R('marketing','Conta de marketing dentro de Materiais'),'2.12.52':R('marketing','Conta de marketing dentro de Materiais'),
  '2.13':R('semDetalhamento','Bancária fora das subcontas de tarifa e juros: confira se é dívida ou despesa'),'2.13.1':R('despesasFinanceiras'),'2.13.2':R('despesasFinanceiras'),'2.13.3':R('despesasFinanceiras'),'2.13.4':R('despesasFinanceiras'),'2.13.5':R('despesasFinanceiras'),'2.13.6':R('dividas'),'2.13.7':R('dividas'),'2.13.7.1.1':R('investimentos'),'2.13.7.1.2':R('investimentos'),'2.13.52':R('semDetalhamento','Fatura de cartão sem os lançamentos'),
  '2.14':R('socios'),'2.14.3':R('dividas'),'2.14.3.4':R('investimentos'),
  '2.15':R('marketing'),'2.16':R('investimentos'),'2.16.51':R('dividas','Empréstimo de terceiros dentro de Investimentos'),
  '2.17':R('dividas'),'2.18':R('transferencias'),'2.99':R('semDetalhamento')
 };
 // [id, nome, tipo, sentido]: sentido +1 entra, −1 sai (para a cor e a cascata)
 const LINHAS=[
  ['vendas','Receita bruta de vendas','total',1],
  ['das','(−) DAS do mês','deducao',-1],['impostosVendas','(−) ISS fora do DAS','deducao',-1],['devolucoes','(−) Devoluções a clientes','deducao',-1],
  ['receitaLiquida','(=) Receita líquida','subtotal',1],
  ['variaveis','(−) Custos variáveis pagos','custo',-1],
  ['margemContribuicao','(=) Margem de contribuição','subtotal',1],
  ['fixas','(−) Despesas fixas','grupo',-1],
  ['pessoal','Pessoal','detalhe',-1],['ocupacao','Ocupação e utilidades','detalhe',-1],['administrativas','Administrativas e terceiros','detalhe',-1],['veiculos','Veículos','detalhe',-1],['marketing','Marketing','detalhe',-1],['taxas','Taxas e IPTU','detalhe',-1],['fixasOutras','Saídas sem linha na DRE','detalhe',-1],
  ['ebitda','(=) Resultado operacional (EBITDA de caixa)','subtotal',1],
  ['receitasFinanceiras','(+) Rendimentos e outras receitas','financeiro',1],['despesasFinanceiras','(−) Juros, tarifas e IOF','financeiro',-1],
  ['resultado','(=) Resultado do mês, antes dos sócios','resultado',1],
  ['socios','(−) Retiradas e arrendamento','ponte',-1],['investimentos','(−) Investimentos e parcelas de ativos','ponte',-1],['dividas','(−) Dívidas, parcelamento do DAS e antecipações','ponte',-1],['transferencias','(−) Transferências entre empresas','ponte',-1],['semDetalhamento','(−) Saídas sem detalhamento','ponte',-1],
  ['emprestimos','(+) Empréstimos recebidos','ponte',1],['aIdentificar','(+) Entradas a identificar','ponte',1],['foraOutras','(+) Entradas sem linha na DRE','ponte',1],
  ['variacao','(=) Variação do caixa no mês','resultado',1]
 ].map(([id,nome,tipo,sentido])=>({id,nome,tipo,sentido}));
 const BASICAS=LINHAS.filter(l=>!['receitaLiquida','margemContribuicao','fixas','ebitda','resultado','variacao'].includes(l.id)).map(l=>l.id);
 const FIXAS=['pessoal','ocupacao','administrativas','veiculos','marketing','taxas','fixasOutras'];
 const cent=v=>Math.round(Number(v)*100);
 // Conta nova ou renomeada pelo ERP (sufixo 51 em diante, sem regra própria) sob
 // uma mãe que mistura despesa com compra ou dívida: a linha é só um palpite.
 const MISTAS=['2.6','2.7','2.14','2.16'];
 function classificar(code){
  const partes=String(code).split('.');
  for(let i=partes.length;i>0;i--){const k=partes.slice(0,i).join('.');if(!REGRAS[k])continue;
   const r={...REGRAS[k],regra:k};
   if(!r.conferir&&i<partes.length&&Number(partes[i])>=51&&MISTAS.includes(k))r.conferir='Conta nova ou renomeada no ERP: confirme se é despesa, compra ou dívida';
   return r;}
  return {linha:String(code).startsWith('1')?'foraOutras':'fixasOutras',conferir:'Conta fora do plano conhecido',nota:'',regra:''};
 }
 // Apura um mês do caixa. Sem registro: null (Não apurado), nunca zero.
 function apurar(reg){
  if(!reg||!Array.isArray(reg.cells))return null;
  const cells=reg.cells.filter(c=>/^\d+(\.\d+)*$/.test(c?.code||'')&&c.value!=null&&c.value!==''&&Number.isFinite(Number(c.value)));
  if(!cells.length)return null;
  const valor=new Map(cells.map(c=>[c.code,cent(c.value)])),filhas=new Map();
  // cada conta desconta só da ancestral mais próxima que existe no mês
  for(const c of cells){const p=c.code.split('.');for(let i=p.length-1;i>0;i--){const a=p.slice(0,i).join('.');if(valor.has(a)){filhas.set(a,(filhas.get(a)||0)+valor.get(c.code));break;}}}
  const soma=Object.fromEntries(BASICAS.map(id=>[id,0])),composicao=Object.fromEntries(BASICAS.map(id=>[id,[]])),conferir=[];
  for(const c of cells){
   const proprio=valor.get(c.code)-(filhas.get(c.code)||0);if(!proprio)continue;
   const k=classificar(c.code),item={code:c.code,name:c.name||c.code,valor:proprio/100,residuo:filhas.has(c.code),conferir:k.conferir,nota:k.nota};
   soma[k.linha]+=proprio;composicao[k.linha].push(item);if(k.conferir)conferir.push({...item,linha:k.linha});
  }
  const v=k=>soma[k]||0,r=n=>n/100;
  const deducoes=v('das')+v('impostosVendas')+v('devolucoes'),receitaLiquida=v('vendas')-deducoes,margemContribuicao=receitaLiquida-v('variaveis');
  const fixas=FIXAS.reduce((t,k)=>t+v(k),0),ebitda=margemContribuicao-fixas,resultado=ebitda+v('receitasFinanceiras')-v('despesasFinanceiras');
  const ponte=v('emprestimos')+v('aIdentificar')+v('foraOutras')-v('socios')-v('investimentos')-v('dividas')-v('transferencias')-v('semDetalhamento');
  const linhas={...Object.fromEntries(BASICAS.map(k=>[k,r(v(k))])),receitaLiquida:r(receitaLiquida),margemContribuicao:r(margemContribuicao),fixas:r(fixas),ebitda:r(ebitda),resultado:r(resultado),variacao:r(resultado+ponte)};
  const vendas=v('vendas'),pct=k=>vendas>0?linhas[k]/r(vendas)*100:null;
  // a DRE inteira tem de fechar com entradas − saídas do ERP
  const total=code=>valor.has(code)?valor.get(code):cells.filter(c=>c.code.split('.').length===2&&c.code.startsWith(code+'.')).reduce((t,c)=>t+valor.get(c.code),0);
  const caixa=r(total('1')-total('2'));
  for(const k of Object.keys(composicao))composicao[k].sort((a,b)=>Math.abs(b.valor)-Math.abs(a.valor));
  return {linhas,composicao,conferir,caixa,diferenca:Math.round((linhas.variacao-caixa)*100)/100,
   margens:{margemContribuicao:pct('margemContribuicao'),ebitda:pct('ebitda'),resultado:pct('resultado'),receitaLiquida:pct('receitaLiquida')},pct};
 }
 // DAS de uma competência: a guia é paga no mês seguinte. Recebe o registro do
 // mês do pagamento; o que estiver no DAS fora das subcontas aparece em "resto".
 function dasDaGuia(regPagamento){
  if(!regPagamento)return null;
  const vc=code=>{const c=regPagamento.cells?.find(x=>x.code===code);return c&&c.value!=null&&c.value!==''&&Number.isFinite(Number(c.value))?cent(c.value):null;};
  const imp=vc('2.4.1.2'),uni=vc('2.4.1.3'),parc=vc('2.4.1.1'),tot=vc('2.4.1');
  const resto=tot==null?0:tot-(imp||0)-(uni||0)-(parc||0),guias=(imp||0)+(uni||0);
  return {impresilk:imp==null?null:imp/100,universo:uni==null?null:uni/100,guias:guias/100,resto:resto/100,total:(guias+resto)/100,temGuia:imp!=null||uni!=null||resto!==0};
 }
 return {REGRAS,LINHAS,FIXAS,classificar,apurar,dasDaGuia};
})();
