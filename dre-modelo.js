/* DRE por competência: rubricas informadas e revisadas, sem inferência a partir do caixa. */
var DREModelo=(()=>{
 const campos=[
  ['produtos','Receita de produtos','Receitas','Vendas reconhecidas no mês, mesmo que ainda não recebidas.'],
  ['servicos','Receita de serviços','Receitas','Serviços reconhecidos pela entrega ou execução aplicável.'],
  ['outrasVendas','Outras receitas de vendas','Receitas','Outras receitas da atividade principal. Não inclua empréstimos.'],
  ['devolucoes','Devoluções e cancelamentos','Deduções','Informe o valor da redução, como número positivo.'],
  ['descontos','Descontos incondicionais','Deduções','Descontos que reduzem o valor da venda.'],
  ['tributosVendas','Tributos sobre vendas','Deduções','Tributos incidentes na receita do período.'],
  ['custos','Custo dos produtos e serviços vendidos','Operação','Materiais consumidos, mão de obra e demais custos correspondentes às vendas; não são todas as compras do mês.'],
  ['despesasVendas','Despesas com vendas','Operação','Comissões, divulgação e estrutura comercial do período.'],
  ['administrativas','Despesas administrativas','Operação','Despesas administrativas incorridas, pagas ou não.'],
  ['outrasDespesas','Outras despesas operacionais','Operação','Demais despesas do período que não constam nos campos anteriores.'],
  ['outrasReceitas','Outras receitas operacionais','Operação','Receitas operacionais fora das vendas, sem duplicar as rubricas anteriores.'],
  ['equivalencia','Resultado de equivalência patrimonial','Operação','Se aplicável, positivo para ganho e negativo para perda.',true],
  ['receitasFinanceiras','Receitas financeiras','Financeiro e tributos','Juros e rendimentos reconhecidos. Não inclua principal de empréstimos.'],
  ['despesasFinanceiras','Despesas financeiras','Financeiro e tributos','Juros e encargos do período; a amortização do principal fica fora.'],
  ['tributosLucro','IRPJ e CSLL correntes','Financeiro e tributos','Despesa tributária sobre o lucro, conforme a apuração.'],
  ['tributosDiferidos','IRPJ e CSLL diferidos','Financeiro e tributos','Despesa positiva; benefício tributário negativo. Preenchimento conforme a apuração contábil.',true],
  ['descontinuadas','Resultado líquido de operações descontinuadas','Ajustes e informações','Se aplicável, já líquido dos tributos. Ganho positivo; perda negativa.',true],
  ['da','Depreciação e amortização incluídas acima','Ajustes e informações','Informação para calcular EBITDA. Este valor já deve integrar os custos e despesas acima: não será descontado novamente.']
 ].map(([id,nome,grupo,ajuda,assinado=false])=>({id,nome,grupo,ajuda,assinado}));
 const cent=v=>v==null||v===''||typeof v!=='number'||!Number.isFinite(v)?null:Math.round(v*100);
 function validar(valores){
  const clean={};for(const f of campos){const x=valores?.[f.id];if(x==null||x===''){clean[f.id]=null;continue;}if(typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e12)throw new Error('Valor inválido em '+f.nome);if(!f.assinado&&x<0)throw new Error('Informe valor positivo em '+f.nome);clean[f.id]=Math.round(x*100)/100;}return clean;
 }
 function calcular(valores){
  const v=validar(valores),out={...v};
  const calc=(id,parts)=>{const nums=parts.map(([key,sinal])=>[cent(out[key]),sinal]);out[id]=nums.some(([n])=>n==null)?null:nums.reduce((sum,[n,sinal])=>sum+n*sinal,0)/100;};
  calc('bruta',[['produtos',1],['servicos',1],['outrasVendas',1]]);
  calc('deducoes',[['devolucoes',1],['descontos',1],['tributosVendas',1]]);
  calc('liquida',[['bruta',1],['deducoes',-1]]);
  calc('bruto',[['liquida',1],['custos',-1]]);
  calc('operacional',[['bruto',1],['despesasVendas',-1],['administrativas',-1],['outrasDespesas',-1],['outrasReceitas',1],['equivalencia',1]]);
  calc('financeiro',[['receitasFinanceiras',1],['despesasFinanceiras',-1]]);
  calc('antesTributos',[['operacional',1],['financeiro',1]]);
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
  ['operacional','(=) Resultado antes de financeiro e tributos','subtotal','EBIT / LAJIR'],['margemOperacional','Margem operacional','ratio','Margem operacional'],['receitasFinanceiras','(+) Receitas financeiras','normal','Receita financeira'],['despesasFinanceiras','(−) Despesas financeiras','normal','Despesa financeira'],['antesTributos','(=) Resultado antes dos tributos sobre o lucro','subtotal','LAIR'],['tributosLucro','(−) IRPJ e CSLL correntes','normal','IRPJ e CSLL'],['tributosDiferidos','(−/+) IRPJ e CSLL diferidos','normal','Tributo diferido'],['continuadas','(=) Resultado das operações continuadas','subtotal','Resultado líquido'],['descontinuadas','(+/−) Operações descontinuadas, líquido','normal','Operação descontinuada'],['liquido','(=) Lucro / prejuízo líquido','result','Resultado líquido'],['margemLiquida','Margem líquida','ratio','Margem líquida'],
  ['da','Depreciação e amortização já incluídas','info','Depreciação'],['ebitda','EBITDA / LAJIDA · operações continuadas','subtotal','EBITDA / LAJIDA'],['margemEbitda','Margem EBITDA','ratio','Margem EBITDA']
 ].map(([id,nome,tipo,termo])=>({id,nome,tipo,termo}));
 function acumulado(months){const keys=Object.keys(calcular({}));const out={};for(const key of keys.filter(k=>!k.startsWith('margem'))){const values=months.map(x=>calcular(x?.valores||{})[key]);out[key]=!values.length||values.some(v=>v==null)?null:values.reduce((sum,v)=>sum+Math.round(v*100),0)/100;}for(const [key,total] of [['margemBruta','bruto'],['margemOperacional','operacional'],['margemLiquida','liquido'],['margemEbitda','ebitda']])out[key]=out.liquida>0&&out[total]!=null?out[total]/out.liquida*100:null;return out;}
 return {campos,linhas,validar,calcular,acumulado};
})();

/* A competência usa um campo próprio da configuração existente, protegido pela
   versão da nuvem. Não cria nem substitui registros de recebimento/pagamento. */
var DRECompetencia=(()=>{
 const campo='demonstrativosCompetencia';
 const obter=(cfg,id)=>cfg?.[campo]?.meses?.[id]||null;
 const igual=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
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
  const clean={label:registro.label,company:registro.company.trim(),fonte:registro.fonte.trim(),notas:String(registro.notas||'').slice(0,3000),basis:'competencia',valores,revisao:registro.revisao,revisadoEm:registro.revisadoEm,estado:Object.values(valores).some(v=>v==null)?'parcial':'preenchido',historico};
  const cfg={...fresh.cfg,[campo]:{...area,versao:1,meses:{...area.meses,[id]:clean}}};
  const res=await api('setCfg',{cfg,baseAtualizadoEm:fresh.atualizadoEm||null});
  if(!res.ok)throw new Error(res.conflito?'A base mudou durante a gravação. Tente salvar novamente para conferir a versão mais recente.':res.erro||'Gravação não confirmada. Sua edição continua aberta.');
  return {ok:true,cfg,atualizadoEm:res.atualizadoEm};
 }
 return {campo,obter,igual,salvar};
})();
