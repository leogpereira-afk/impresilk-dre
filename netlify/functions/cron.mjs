// netlify/functions/cron.mjs
// Função AGENDADA (schedule "@hourly" no netlify.toml). Roda na nuvem sem
// ninguém abrir o site. Aqui serve só de healthcheck/keepalive: toca o store
// de config para mantê-lo "quente" e registra a execução. Amplie se precisar
// (ex.: limpeza de fotos órfãs, backup, agregações noturnas).
import { getStore } from '@netlify/blobs';

export default async () => {
  try {
    const cfg = getStore('os-config');
    await cfg.setJSON('cron', { ultimaExecucao: new Date().toISOString() });
  } catch (e) {
    console.error('cron falhou:', e);
  }
  return new Response('ok');
};
