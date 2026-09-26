# Publicar a função `dre-financas` (Supabase) — 25/09/2026

O código está no git (commit "Segurança do DRE…"). O Supabase **não** republica
as functions no push: até publicar, o servidor segue com a porta antiga.

## O que muda
- Lista fechada de recursos do ERP para **todo mundo** (contas a pagar/receber,
  conta bancária e O.S. por número). Antes, qualquer crachá do DRE conseguia
  ler qualquer caminho do Mubisys (funcionários, clientes…) com a credencial da
  empresa.
- `listar`, `preview`, `raw`, `ping` e `statusConfig` ficam com a máquina
  (x-token) e com a administração. A tela do DRE usa só `importarMes`, que
  continua aberta para quem entra.
- Se o banco não responder na hora de conferir o papel, a consulta fecha (503).

## Como publicar (uma vez)
```bash
export SUPABASE_ACCESS_TOKEN=sbp_...   # https://supabase.com/dashboard/account/tokens
./scripts/publicar-functions.sh dre-financas
```
Depois, na tela do DRE, "Conferir com o Mubisys" precisa seguir funcionando.
