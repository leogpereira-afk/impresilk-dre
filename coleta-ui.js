/* Acompanhamento do trabalho no servidor. Nenhuma credencial de máquina no navegador. */
const DREColeta = (() => {
  function visao(s) {
    if (!s) return {titulo:'Conferindo atualização automática…',descricao:'Consultando o estado da rotina.',podeSolicitar:false};
    if (!s.ativa) return {titulo:'Atualização automática: ativação pendente',descricao:'A rotina ainda precisa ser configurada. A base salva continua disponível.',podeSolicitar:false};
    const textos={
      aguardando:['Atualização solicitada','O servidor atenderá na próxima execução. Pode levar alguns minutos; você pode fechar esta tela.'],
      executando:['Buscando dados novos no Mubisys','Recebimentos, pagamentos e O.S. estão sendo conferidos. Você pode fechar esta tela.'],
      concluido:['Última coleta processada','Confira abaixo os meses gravados, preservados ou sem lançamentos.'],
      erro:['A última coleta encontrou uma falha','Confira os meses processados abaixo. Você pode solicitar uma nova tentativa.'],
      interrompido:['Coleta interrompida','A execução não confirmou o término. A rotina tentará novamente; os meses salvos continuam disponíveis.']
    };
    const [titulo,descricao]=textos[s.estado]||['Atualização automática ativa','A rotina revisa o mês atual e o anterior às 06h, 12h e 18h, no horário de Brasília.'];
    return {titulo,descricao,podeSolicitar:!['aguardando','executando'].includes(s.estado)};
  }
  function controlador({api,render,onConcluido}) {
    let status=null,erro='',pedindo=false,lendo=false,generation=0,lastKey=null;
    const show=()=>render({status,erro,pedindo,...visao(status)});
    async function aceitar(r,gen) {
      if(gen!==generation)return;
      if(!r?.ok)throw new Error(r?.erro||'Não foi possível acompanhar a atualização.');
      status=r.status;erro='';show();
      const t=status?.ultimaTentativa;
      const key=t?.em?`${t.runId}:${t.em}`:null;
      const changed=lastKey!==null&&key&&lastKey!==key;
      if(key)lastKey=key;else if(lastKey===null)lastKey='sem-tentativa';
      if(changed)await onConcluido();
    }
    async function consultar(){
      if(lendo||pedindo)return;
      lendo=true;const gen=generation;
      try{await aceitar(await api('coletaStatus'),gen);}
      catch(e){if(gen===generation){erro=e.message;show();}}
      finally{if(gen===generation)lendo=false;}
    }
    async function solicitar(){
      if(pedindo)return;
      pedindo=true;erro='';show();const gen=generation;
      try{await aceitar(await api('solicitarColeta'),gen);}
      catch(e){if(gen===generation){erro=e.message;show();}}
      finally{if(gen===generation){pedindo=false;show();}}
    }
    function reset(){generation++;status=null;erro='';pedindo=false;lendo=false;lastKey=null;show();}
    return {consultar,solicitar,reset,show};
  }
  return {visao,controlador};
})();
