#!/usr/bin/env python3
"""Monta o site com lista explícita de arquivos públicos, sem dados financeiros."""
from pathlib import Path
import argparse,re,shutil
ROOT=Path(__file__).resolve().parents[1]
FILES=('cfo-modelo.js','cfo.js','cfo.css','pdf-cfo.js','vendor/jspdf.umd.min.js','vendor/jspdf.plugin.autotable.min.js','vendor/jspdf-LICENSE.txt','vendor/autotable-LICENSE.txt','index.html','styles.css','app.js','financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','config.js','auth.js','sw.js','data.js','logo.png','favicon.svg','manifest.webmanifest','icone-192.png','icone-512.png','inter-variable.woff2','inter-OFL.txt')
def build(destination):
    sw=(ROOT/'sw.js').read_text();html=(ROOT/'index.html').read_text()
    version=re.search(r"const CACHE = 'dre-shell-v(\d+)'",sw).group(1)
    if set(re.findall(r'\?v=(\d+)',html))!={version}:raise ValueError('Versões da página e cache não correspondem')
    if len((ROOT/'data.js').read_text())>500:raise ValueError('data.js não deve conter histórico financeiro')
    dest=Path(destination);dest.mkdir(parents=True,exist_ok=True)
    # Não apagar arquivos desconhecidos: usar sempre pasta vazia para o pacote.
    if any(dest.iterdir()):raise ValueError('Use uma pasta vazia para gerar o site')
    for name in FILES:
        (dest/name).parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT/name,dest/name)
    print('Pacote público validado: %d arquivos, versão %s.'%(len(FILES),version))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination');args=parser.parse_args();build(args.destination)
