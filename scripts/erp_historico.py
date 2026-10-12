"""Carga histórica do DRE (Fase 10.1): traz os meses antigos do Mubisys, um por vez.

Usa o mesmo processamento do robô de cada dia (erp_previa.processar): os mesmos
controles (totais e trilha que fecham), a mesma classificação e a mesma proteção dos
meses de planilha, que nunca são substituídos. Os meses vão sem a trilha por
pagamento (DRE_SEM_TRILHA=1, posto pelo workflow) para o app continuar leve.

Só meses que já acabaram e anteriores ao mês passado: o mês atual e o anterior são do
robô de cada dia. Um mês que falha não para a carga: ela segue e termina com erro,
dizendo quantos falharam. O log do GitHub é público: só contagens e o rótulo do mês.

Revisão (12/10): a primeira rodada (130 meses) estourou o limite de 340 min do GitHub
sem dizer onde parou. Agora: a lista do servidor é lida uma vez; mês de planilha e mês
já trazido do ERP são pulados sem consultar o Mubisys (rodar de novo continua de onde
parou e não tira a trilha dos meses do robô de cada dia); a carga para sozinha antes
do limite (DRE_HIST_LIMITE_MIN, padrão 300) e depois de 3 falhas seguidas; o quadro
mês a mês vai para o resumo da execução no GitHub, só com estados e contagens.
"""
import datetime
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import erp_previa as previa


def meses(de, ate, hoje=None):
    """'AAAA-MM' a 'AAAA-MM' → lista de datas (dia 1), só meses anteriores ao mês passado."""
    hoje = hoje or datetime.date.today()
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", de or "") or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", ate or ""):
        raise ValueError("Use meses no formato AAAA-MM.")
    a = datetime.date(int(de[:4]), int(de[5:]), 1)
    b = datetime.date(int(ate[:4]), int(ate[5:]), 1)
    if a > b:
        raise ValueError("O primeiro mês vem depois do último.")
    corrente = hoje.replace(day=1)
    anterior = (corrente - datetime.timedelta(days=1)).replace(day=1)
    if b >= anterior:
        raise ValueError("O mês atual e o anterior são do robô de cada dia: termine a carga antes deles.")
    out, d = [], a
    while d <= b:
        out.append(d)
        d = (d + datetime.timedelta(days=32)).replace(day=1)
    if len(out) > 240:
        raise ValueError("No máximo 20 anos por rodada.")
    return out


ESTADOS = {
    "gravado": "gravado", "simulado": "simulado: seria gravado", "vazio": "sem lançamento no ERP",
    "preservado": "veio da planilha: preservado", "ja-carregado": "já estava no DRE: pulado",
    "falhou": "falhou", "sem-tempo": "não começou: limite de tempo", "interrompido": "não começou: falhas seguidas",
}
FALHAS_SEGUIDAS = 3
# Motivos que podem ir ao log público: frases fixas do robô, sem nenhum dado. Qualquer
# outro texto (por exemplo, o que o servidor devolveu) continua escondido: só o tipo.
MOTIVOS_SEGUROS = {
    "Coleta incompleta; última versão preservada.",
    "Título sem identificador; coleta não verificável.",
    "Título alterado durante a coleta; repita para obter uma versão consistente.",
    "Histórico não confirmado", "Histórico parcial", "Paginação inválida",
    "Configurações não confirmadas",
    "Configuração privada de classificação não validada; nada foi gravado.",
    "Trilha de pagamentos não fecha; nada foi gravado.",
    "Os totais de controle não fecham; nada foi gravado.",
    "Conflito: versão concorrente preservada.",
    "Gravação não confirmada pelo servidor.",
}


def motivo(e):
    """O motivo da falha para o log público: a frase fixa, ou só o tipo do erro."""
    m = str(e)
    return m if m in MOTIVOS_SEGUROS else type(e).__name__


def resumo_github(linhas, fim):
    """Quadro no resumo da execução (público): só mês, estado e contagem de O.S."""
    destino = os.environ.get("GITHUB_STEP_SUMMARY")
    if not destino:
        return
    corpo = ["### Carga histórica do DRE", "", "| Mês | Resultado | O.S. não lidas |", "|---|---|---|"]
    corpo += [f"| {r} | {ESTADOS.get(e, e)} | {n if n else ''} |" for r, e, n in linhas]
    with open(destino, "a", encoding="utf-8") as f:
        f.write("\n".join(corpo + ["", fim, ""]))


def main(argv=None, processar=None, aviso=print, listar=None, relogio=time.monotonic):
    argv = sys.argv[1:] if argv is None else argv
    processar = processar or previa.processar
    listar = listar or previa.listar_meses
    if len(argv) != 2:
        raise SystemExit("Uso: erp_historico.py AAAA-MM AAAA-MM")
    alvos = meses(argv[0], argv[1])
    limite = float(os.environ.get("DRE_HIST_LIMITE_MIN") or 300) * 60
    inicio = relogio()
    try:
        servidor = listar()
    except Exception as e:
        raise SystemExit(f"Não li os meses já gravados ({type(e).__name__}); nada foi consultado no Mubisys.")
    no_dre = {r.get("label"): r for r in servidor if isinstance(r, dict)}
    contagem, linhas, seguidas, parar = {}, [], 0, None
    for ini in alvos:
        rotulo = f"{previa.PT[ini.month - 1]}/{ini.year}"
        os_faltando = 0
        atual = no_dre.get(rotulo)
        if parar:
            estado = parar
        elif atual is not None:
            # Planilha nunca é trocada; mês do ERP já trazido não é recoletado.
            estado = "preservado" if atual.get("origem") != "erp" else "ja-carregado"
        elif relogio() - inicio > limite:
            estado = parar = "sem-tempo"
        else:
            try:
                r = processar(ini, servidor) or {}
                estado = r.get("estado") or "sem-estado"
                os_faltando = int(r.get("osFaltando") or 0)
                seguidas = 0
            except Exception as e:  # o motivo pode citar dado: vai só o tipo do erro
                estado = "falhou"
                seguidas += 1
                aviso(f"{rotulo}: falhou ({motivo(e)}); a carga segue para o próximo mês.")
                if seguidas >= FALHAS_SEGUIDAS:
                    parar = "interrompido"
                    aviso(f"{FALHAS_SEGUIDAS} falhas seguidas: a carga para aqui (servidor ou Mubisys fora do ar?).")
        if os_faltando:
            aviso(f"{rotulo}: {os_faltando} O.S. citada(s) não lida(s); a receita delas ficou em \"sem O.S. completa\".")
        contagem[estado] = contagem.get(estado, 0) + 1
        linhas.append((rotulo, estado, os_faltando))
    resumo = ", ".join(f"{k}: {v}" for k, v in sorted(contagem.items()))
    falta = next((ini for ini, (_, e, _n) in zip(alvos, linhas) if e in ("sem-tempo", "interrompido")), None)
    fim = f"Carga histórica de {len(alvos)} mês(es): {resumo}."
    if falta:
        fim += (f" Rode de novo de {falta:%Y-%m} a {alvos[-1]:%Y-%m}" if os.environ.get("DRE_PUBLISH") == "1"
                else f" Simulação não grava: rode de novo de {falta:%Y-%m} a {alvos[-1]:%Y-%m}") + \
            " (os meses já no DRE são pulados)."
    aviso(fim)
    resumo_github(linhas, fim)
    if contagem.get("falhou"):
        raise SystemExit(f"{contagem['falhou']} mês(es) falharam; rode de novo o mesmo intervalo (os gravados são pulados).")
    return contagem


if __name__ == "__main__":
    main()
