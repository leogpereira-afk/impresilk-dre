"""Atende pedidos do painel e as três janelas diárias usando o mesmo coletor."""
import os
import erp_previa as previa


def arquivar_intel():
    """Guarda no DRE cada importação "Inteligência" do Painel (Fase 9.3): o Painel
    mantém um recorte por vez; o servidor arquiva cada um por fonte e período. Roda a
    cada passagem, é barato e nunca derruba a coleta: falhou, tenta na próxima. O log
    do GitHub é público: só contagens."""
    try:
        r = previa.call('dre-sync', {'action': 'intelArquivar'}, timeout=60, tentativas=2)
    except Exception:
        print('Arquivo das importações do Painel indisponível agora; tenta de novo na próxima passagem.')
        return None
    if not isinstance(r, dict) or r.get('ok') is not True:
        print('Arquivo das importações do Painel não confirmado; tenta de novo na próxima passagem.')
        return None
    est = [a.get('estado') for a in r.get('arquivos') or [] if isinstance(a, dict)]
    print(f"Arquivo do Painel: {est.count('gravado')} recorte(s) novo(s), {est.count('igual')} já guardado(s), {est.count('incompleto')} incompleto(s).")
    return est


def main():
    if os.environ.get('DRE_PUBLISH') != '1':
        return previa.main()
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    start = previa.call('dre-sync', {'action': 'coletaIniciar', 'runId': run_id,
        'forcar': os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'})
    if start.get('ok') is not True:
        raise RuntimeError('Não foi possível assumir a coleta; nenhum período foi alterado.')
    arquivar_intel()
    if not start.get('executar'):
        print('Rotina disponível. Nenhum pedido ou nova janela de coleta.')
        return
    meses = []
    try:
        previa.main(on_month=meses.append)
    except Exception:
        try:
            previa.call('dre-sync', {'action': 'coletaConcluir', 'runId': run_id,
                'ok': False, 'meses': meses})
        except Exception:
            print('O acompanhamento não respondeu. O painel detectará a execução interrompida.')
        raise
    result = previa.call('dre-sync', {'action': 'coletaConcluir', 'runId': run_id,
        'ok': True, 'meses': meses})
    if result.get('ok') is not True:
        raise RuntimeError('Meses processados, mas acompanhamento não confirmado. Confira a execução.')


if __name__ == '__main__':
    main()
