import {validarPeriodo,normalizarSnapshot,normalizarComercial,resumir,DICIONARIO} from '../../../indicadores-modelo.mjs';
const FONTES=['comercial','fiscal','compras','custos','margem'];
export async function consultarIndicadores(sb,body){
 const p=validarPeriodo(body.de,body.ate),fonte=body.fonte;
 if(!FONTES.includes(fonte))throw new Error('Fonte inválida.');
 const filtros={query:String(body.query||'').slice(0,160),grupo:String(body.grupo||'').slice(0,200),dimensao:['grupo','cliente','vendedor'].includes(body.dimensao)?body.dimensao:'grupo',pagina:Math.max(0,Number(body.pagina)||0),tamanho:body.exportar===true?5000:50};
 let base;
 if(fonte==='comercial'){
  let itens=[];for(let offset=0;offset<5001;offset+=500){const {data,error}=await sb.from('painel_ordens').select('id,numero,data,cliente,vendedor,valor,comercial,atualizado_em').gte('data',p.de).lte('data',p.ate).order('id').range(offset,offset+499);if(error)throw new Error('Não foi possível consultar o histórico comercial.');itens.push(...(data||[]));if(!data?.length||data.length<500)break;}
  if(itens.length>5000)throw new Error('Este intervalo ultrapassa 5.000 O.S. Reduza o período para conferir todos os registros.');
  base={rows:normalizarComercial(itens),disponivel:true,qualidade:'Parcial',fontes:[{em:itens.map(r=>r.atualizado_em).filter(Boolean).sort().at(-1)||null,periodo:`${p.de} a ${p.ate}`,corte:null,conciliado:false}],avisos:['Histórico comercial armazenado. O.S. canceladas, de retrabalho ou sem tipo normal confirmado são excluídas; valores não confirmados ficam sem valor. Cobertura integral do ERP não comprovada.'],limite:DICIONARIO.comercial.limite};
 }else{const chave={fiscal:'intel_nfe',compras:'intel_compras',custos:'intel_detalhes',margem:'intel_detalhes'}[fonte];const {data,error}=await sb.from('painel_cache').select('valor,atualizado_em').eq('chave',chave).maybeSingle();if(error)throw new Error('Não foi possível ler a fonte importada.');base=normalizarSnapshot(data?.valor,fonte,p);}
 const {rows,...meta}=base;return {ok:true,versao:1,fonte,periodo:p,...meta,...resumir(rows,filtros),...(!base.disponivel?{valor:null}:{})};
}
