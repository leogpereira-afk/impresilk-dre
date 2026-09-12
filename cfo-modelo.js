/* Leitura gerencial explicável. Não grava, reclassifica nem completa dados ausentes. */
var DRECFO = (() => {
 const cent = n => Math.round(n * 100);
 const soma = xs => xs.reduce((n,x)=>n+cent(x),0)/100;
 const normal = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const caixa = {
  entradas:[['1',1]], saidas:[['2',1]], variacao:[['1',1],['2',-1]],
  operacionais:[['1.1',1],['1.2',1],['1.5',1],['1.6',1]], emprestimos:[['1.4',1]], rendimentos:[['1.3',1]], naoIdentificadas:[['1.7',1]],
  outrasEntradas:[['1',1],['1.1',-1],['1.2',-1],['1.5',-1],['1.6',-1],['1.4',-1],['1.3',-1],['1.7',-1]],
  socios:[['2.14',1],['2.14.3',-1]], parcelasAtivos:[['2.13.7.1.1',1],['2.13.7.1.2',1],['2.14.3.4',1]],
  dividas:[['2.13.6',1],['2.17',1],['2.14.3',1],['2.14.3.4',-1],['2.13.7.1.3',1]],
  transferencias:[['2.18',1]], investimentos:[['2.16',1]], pendentes:[['2.99',1]],
 };
 caixa.pagamentosOperacionais=[['2',1],...['socios','parcelasAtivos','dividas','transferencias','investimentos','pendentes'].flatMap(k=>caixa[k].map(([c,s])=>[c,-s]))];
 caixa.saldoOperacional=[...caixa.operacionais,...caixa.pagamentosOperacionais.map(([c,s])=>[c,-s])];
 const competencia={bruta:[['produtos',1],['servicos',1],['outrasVendas',1]],deducoes:[['devolucoes',1],['descontos',1],['tributosVendas',1]],liquida:[['bruta',1],['deducoes',-1]],bruto:[['liquida',1],['custos',-1]],operacional:[['bruto',1],['despesasVendas',-1],['administrativas',-1],['outrasDespesas',-1],['outrasReceitas',1],['equivalencia',1]],financeiro:[['receitasFinanceiras',1],['despesasFinanceiras',-1]],antesTributos:[['operacional',1],['financeiro',1]],continuadas:[['antesTributos',1],['tributosLucro',-1],['tributosDiferidos',-1]],liquido:[['continuadas',1],['descontinuadas',1]],ebitda:[['operacional',1],['da',1]]};
 const margens={margemBruta:'bruto',margemOperacional:'operacional',margemLiquida:'liquido',margemEbitda:'ebitda'};
 function decompor(reg,id){
  const terms=caixa[id]||[[id,1]];
  const partes=terms.map(([code,sinal])=>({code,sinal,name:reg?.cells?.find(c=>c.code===code)?.name||code,value:DREFinancas.valorConta(reg,code)}));
  const existe=!!reg&&DREFinancas.valorConta(reg,'1')!=null&&DREFinancas.valorConta(reg,'2')!=null;
  const value=caixa[id]?(existe?DREFinancas.resumo(reg)[id]:null):DREFinancas.valorConta(reg,id);
  return {id,value,partes,formula:terms.map(([c,s],i)=>(s<0?'− ':i?'+ ':'')+c).join(' '),ausentes:partes.filter(p=>p.value==null).length};
 }
 function pergunta(nome){
  const n=normal(nome);
  if(/material|insumo|tinta|lona|vinil|acrilico|acm/.test(n))return 'Conferir consumo por O.S., perdas de corte e impressão, compras para estoque e materiais retrabalhados. Pagamento de compra não mede o custo consumido.';
  if(/funcionario|pessoal|salario|folha/.test(n))return 'Conferir horas produtivas, horas extras, instalação e retrabalho por O.S.; o total pago não mede produtividade sozinho.';
  if(/terceir|instal|veiculo|frete|combust/.test(n))return 'Conferir deslocamentos, montagem e terceiros por O.S. e separar entrega prevista de retorno por retrabalho.';
  if(/maquina|equipamento|manutenc/.test(n))return 'Separar manutenção, compra de equipamento e parcela de financiamento; comparar paradas e horas produtivas antes de decidir.';
  if(/banc|juro|divida|emprest/.test(n))return 'Abrir contratos e separar principal, juros, tarifas e antecipação de recebíveis antes de avaliar o custo financeiro.';
  if(/socio|arrendamento/.test(n))return 'Separar pró-labore, distribuição, mútuos e arrendamento conforme contratos. Saída para sócio não tem uma única natureza contábil.';
  if(/energia|cemig|agua|copasa/.test(n))return 'Comparar consumo físico, tarifa e dias de produção. O valor pago isolado não identifica a causa de aumento.';
  return 'Conferir os lançamentos, datas e documentos; identificar recorrência, gastos excepcionais e vínculo com as ordens de serviço.';
 }
 function analise(reg,anterior){
  const f=DREFinancas,q=f.qualidade(reg),e=f.valorConta(reg,'1'),s=f.valorConta(reg,'2');
  const comp=f.composicao(reg,'2');
  const ranking=comp.itens.filter(x=>x.value!=null&&x.value!==0).map(x=>({...x,peso:s>0&&!comp.incompleta?x.value/s*100:null,pergunta:pergunta(x.name)})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  const variacoes=ranking.filter(x=>!x.residuo).map(x=>({...x,...f.compararConta(reg,anterior,x.code)})).filter(x=>x.permitida&&x.delta!==0).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  const residual=comp.itens.find(x=>x.residuo)?.value||0;
  return {q,entradas:e,saidas:s,variacao:e!=null&&s!=null?soma([e,-s]):null,ranking,variacoes,residual,incompleta:comp.incompleta,comparavel:f.comparacao(reg,anterior).permitida,
   maiores:ranking.filter(x=>x.value>0).slice(0,3),concentracao:s>0&&!comp.incompleta?soma(ranking.filter(x=>x.value>0).slice(0,3).map(x=>x.value))/s*100:null};
 }
 function origem(reg,code){
  // Sem o mapa da coleta não se associa código de receita ao produto vendido.
  const all=reg?.eventos||[];
  if(code==='1'||code==='2')return {disponivel:all.length>0,eventos:all.filter(e=>e.natureza===(code==='1'?'entrada':'saida')),nota:'Movimentos de toda a entrada ou saída da coleta.'};
  return {disponivel:false,eventos:[],nota:'O vínculo entre esta conta gerencial e os pagamentos de origem não está comprovado nesta base. Consulte a trilha geral na Conferência; não são atribuídos lançamentos por semelhança de nomes.'};
 }
 function sensibilidade({receita,custoVariavel,fixos,meta=0}){
  const vals=[receita,custoVariavel,fixos,meta];if(vals.some(v=>typeof v!=='number'||!Number.isFinite(v))||receita<=0||custoVariavel<0||fixos<0||meta<0)return {valido:false,motivo:'Informe receita positiva e premissas não negativas.'};
  const mc=(receita-custoVariavel)/receita;
  if(mc<=0)return {valido:false,motivo:'Sem margem de contribuição positiva, aumentar o volume não cobre os gastos fixos neste cenário.'};
  return {valido:true,mc,resultado:soma([receita,-custoVariavel,-fixos]),equilibrio:fixos/mc,vendaMeta:(fixos+meta)/mc};
 }
 return {caixa,competencia,margens,decompor,analise,pergunta,origem,sensibilidade,soma};
})();
