#!/usr/bin/env python3
"""Monta o site com lista explícita de arquivos públicos, sem dados financeiros."""
from pathlib import Path
import argparse,re,shutil
ROOT=Path(__file__).resolve().parents[1]
FILES=('cfo-modelo.js','cfo.js','cfo.css','pdf-cfo.js','vendor/jspdf.umd.min.js','vendor/jspdf.plugin.autotable.min.js','vendor/jspdf-LICENSE.txt','vendor/autotable-LICENSE.txt','index.html','styles.css','app.js','coleta-ui.js','financeiro.js','graficos.js','dre-modelo.js','demonstrativos.js','glossario.js','config.js','auth.js','sw.js','data.js','logo.png','favicon.svg','manifest.webmanifest','icone-192.png','icone-512.png','inter-variable.woff2','inter-OFL.txt')
def conferir_pagina(html,sw):
    """O que a página pede precisa ir no pacote e, se leva ?v=, no cache offline.

    Sem isto um arquivo novo (ou renomeado) passava pelo teste e só aparecia
    quebrado no celular: 404 no Pages ou tela sem estilo offline."""
    locais=[u for u in re.findall(r'(?:src|href)="([^"#]+)"',html) if not re.match(r'[a-z]+:|//',u)]
    for js in sorted(ROOT.glob('*.js')):locais+=re.findall(r"['\"](vendor/[^'\"?]+)['\"]",js.read_text())
    faltam=sorted({u.split('?')[0] for u in locais}-set(FILES))
    if faltam:raise ValueError('A página pede arquivos fora do pacote: '+', '.join(faltam))
    shell=set(re.findall(r"`\./([^`?]+)\?v=\$\{V\}`",sw))
    fora=sorted({u.split('?')[0] for u in locais if '?v=' in u and re.search(r'\.(js|css)\?',u)}-shell)
    if fora:raise ValueError('Arquivos versionados fora do cache offline (SHELL do sw.js): '+', '.join(fora))
    # A CSP da página não aceita script inline: um <script> sem src ficaria mudo.
    if re.search(r'<script(?![^>]*\bsrc=)[^>]*>',html):raise ValueError('Script inline na página: a CSP bloqueia. Mova para um .js.')
    if 'Content-Security-Policy' not in html:raise ValueError('A página perdeu a Content-Security-Policy.')
    app=(ROOT/'app.js').read_text()
    if 'cdn.jsdelivr.net/npm/xlsx' in app and "s.integrity = 'sha384-" not in app:raise ValueError('O leitor de planilhas do CDN precisa de integridade (SRI).')
def build(destination):
    sw=(ROOT/'sw.js').read_text();html=(ROOT/'index.html').read_text()
    version=re.search(r"const CACHE = 'dre-shell-v(\d+)'",sw).group(1)
    if set(re.findall(r'\?v=(\d+)',html))!={version}:raise ValueError('Versões da página e cache não correspondem')
    if len((ROOT/'data.js').read_text())>500:raise ValueError('data.js não deve conter histórico financeiro')
    conferir_pagina(html,sw)
    dest=Path(destination);dest.mkdir(parents=True,exist_ok=True)
    # Não apagar arquivos desconhecidos: usar sempre pasta vazia para o pacote.
    if any(dest.iterdir()):raise ValueError('Use uma pasta vazia para gerar o site')
    for name in FILES:
        (dest/name).parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT/name,dest/name)
    print('Pacote público validado: %d arquivos, versão %s.'%(len(FILES),version))
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination');args=parser.parse_args();build(args.destination)
