# Publicar a função `dre-financas` (Supabase)

O código já está commitado. Falta **publicar** a Edge Function — isso exige uma
credencial do Supabase que eu não tenho. São 3 comandos, uma vez só.

> Nada aqui é urgente: a integração está funcionando. O que estas mudanças
> corrigem é o **diagnóstico** — hoje a função grita "erro" quando o único
> problema é o período não ter lançamento nenhum.

---

## O que muda nesta publicação

Duas alterações em `supabase/functions/dre-financas/index.ts`, medidas no teste
de conexão de 10/08/2026:

1. **O `ping` passa a responder "a integração está viva?" em vez de "esse
   período tem dado?".** O Mubisys devolve **404** para janela sem lançamento e
   **422** quando falta a data. Nos dois casos ele falou conosco e aceitou a
   credencial — a conexão está boa. Antes o ping devolvia `ok:false` e o teste
   acusava queda num domingo sem pagamento. Medido:

   | janela testada | antes | agora |
   |---|---|---|
   | ontem → hoje (sem pagamento) | `ok:false, http:404` | `ok:true` · “conexão OK — período sem lançamento” |
   | mês corrente | `ok:true` | `ok:true` |
   | sem informar datas | `ok:false, http:422` | `ok:true` · “conexão OK — faltou informar o período” |

2. **`listar` e `preview` devolvem lista vazia no 404, em vez de HTTP 502.**
   Período sem lançamento é ausência de dado, não falha de servidor. O robô
   (`scripts/erp_previa.py`) já contornava isso por conta própria; o painel não.

Nada existente muda de comportamento para período COM dado. É seguro.

---

## Como publicar

### 1. Instalar a CLI do Supabase (só na primeira vez)

```bash
brew install supabase/tap/supabase
```

### 2. Entrar na conta

```bash
supabase login
```

Abre o navegador e pede para autorizar. É a conta do projeto
`heveemylixartyijxewh`.

### 3. Publicar

```bash
supabase functions deploy dre-financas --project-ref heveemylixartyijxewh
```

---

## Como saber que deu certo

No painel, aba **Conferência → Auditoria · Mubisys × DRE**, botão **Testar**:
deve dizer *OK* mesmo no dia 1º do mês, antes do primeiro pagamento.

Ou pela linha de comando, com o TOKEN que está em `config.js`:

```bash
curl -s -X POST https://heveemylixartyijxewh.supabase.co/functions/v1/dre-financas -H 'content-type: application/json' -H "x-token: $TOKEN" -d '{"action":"ping"}'
```

Antes respondia `{"ok":false,"http":422}`. Depois da publicação deve responder
`{"ok":true,...,"detalhe":"conexão OK — faltou informar o período"}`.
