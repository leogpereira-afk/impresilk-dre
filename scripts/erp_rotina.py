"""Atende pedidos do painel e as três janelas diárias usando o mesmo coletor."""
import os
import erp_previa as previa


def main():
    if os.environ.get('DRE_PUBLISH') != '1':
        return previa.main()
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    start = previa.call('dre-sync', {'action': 'coletaIniciar', 'runId': run_id,
        'forcar': os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'})
    if start.get('ok') is not True:
        raise RuntimeError('Não foi possível assumir a coleta; nenhum período foi alterado.')
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
