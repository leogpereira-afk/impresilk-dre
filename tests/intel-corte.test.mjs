import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizarSnapshot} from '../indicadores-modelo.mjs';
test('mês em andamento mostra corte real preservando recorte mensal das O.S.',()=>{
 const r=normalizarSnapshot({completo:true,desde:'2026-10-01',ate:'2026-10-31',corte:'2026-10-25',em:'2026-10-25T12:00:00Z',itens:[{id:'1',venda:10000,custo:6000}]},'custos',{de:'2026-10-01',ate:'2026-10-31'});
 assert.equal(r.disponivel,true);assert.equal(r.fontes[0].corte,'2026-10-25');assert.ok(r.avisos.some(x=>x.includes('25/10/2026')&&/parcial/i.test(x)));assert.equal(r.rows[0].valor,60);
});
