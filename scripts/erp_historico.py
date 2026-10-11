"""Carga histórica do DRE (Fase 10.1): traz os meses antigos do Mubisys, um por vez.

Usa o mesmo processamento do robô de cada dia (erp_previa.processar): os mesmos
controles (totais e trilha que fecham), a mesma classificação e a mesma proteção dos
meses de planilha, que nunca são substituídos. Os meses vão sem a trilha por
pagamento (DRE_SEM_TRILHA=1, posto pelo workflow) para o app continuar leve.

Só meses que já acabaram e anteriores ao mês passado: o mês atual e o anterior são do
robô de cada dia. Um mês que falha não para a carga: ela segue e termina com erro,
dizendo quantos falharam. O log do GitHub é público: só contagens e o rótulo do mês.
"""
import datetime
import re
import sys
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


def main(argv=None, processar=None, aviso=print):
    argv = sys.argv[1:] if argv is None else argv
    processar = processar or previa.processar
    if len(argv) != 2:
        raise SystemExit("Uso: erp_historico.py AAAA-MM AAAA-MM")
    alvos = meses(argv[0], argv[1])
    contagem = {}
    for ini in alvos:
        rotulo = f"{previa.PT[ini.month - 1]}/{ini.year}"
        try:
            estado = (processar(ini) or {}).get("estado") or "sem-estado"
        except Exception as e:  # o motivo pode citar dado: vai só o tipo do erro
            estado = "falhou"
            aviso(f"{rotulo}: falhou ({type(e).__name__}); a carga segue para o próximo mês.")
        contagem[estado] = contagem.get(estado, 0) + 1
    resumo = ", ".join(f"{k}: {v}" for k, v in sorted(contagem.items()))
    aviso(f"Carga histórica de {len(alvos)} mês(es): {resumo}.")
    if contagem.get("falhou"):
        raise SystemExit(f"{contagem['falhou']} mês(es) falharam; rode de novo só esses meses.")
    return contagem


if __name__ == "__main__":
    main()
