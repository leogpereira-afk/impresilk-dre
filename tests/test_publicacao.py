import re,tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_site
class PacoteTest(unittest.TestCase):
    def test_publica_so_lista_explicita_sem_banco_ou_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            build_site.build(d)
            files={p.relative_to(d).as_posix() for p in Path(d).rglob('*') if p.is_file()}
            self.assertEqual(files,set(build_site.FILES))
            self.assertNotIn('scripts',files)
            self.assertNotIn('tests',files)
            self.assertNotIn('DRE_DATA',(Path(d)/'data.js').read_text())
    def test_nao_mistura_pacote_com_arquivos_anteriores(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'arquivo-privado.json';p.write_text('{}')
            with self.assertRaises(ValueError):build_site.build(d)
            self.assertTrue(p.exists())
    def test_pagina_pede_so_o_que_vai_no_pacote_e_no_cache(self):
        html=(build_site.ROOT/'index.html').read_text();sw=(build_site.ROOT/'sw.js').read_text()
        build_site.conferir_pagina(html,sw)
        with self.assertRaisesRegex(ValueError,'fora do pacote'):
            build_site.conferir_pagina(html.replace('</body>','<script src="novo.js?v=1"></script></body>'),sw)
        with self.assertRaisesRegex(ValueError,'cache offline'):
            build_site.conferir_pagina(html,sw.replace("  `./cfo.js?v=${V}`,\n",''))
        with self.assertRaisesRegex(ValueError,'inline'):
            build_site.conferir_pagina(html.replace('</body>','<script>alert(1)</script></body>'),sw)
        with self.assertRaisesRegex(ValueError,'Content-Security-Policy'):
            build_site.conferir_pagina(html.replace('Content-Security-Policy','x'),sw)
    def test_csp_fecha_a_porta_para_script_de_fora(self):
        html=(build_site.ROOT/'index.html').read_text()
        csp=re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"',html).group(1)
        diretivas={d.split()[0]:d.split()[1:] for d in csp.split('; ')}
        # Só o arquivo exato do leitor de planilhas: o domínio inteiro do CDN
        # serve qualquer pacote do npm/GitHub, inclusive de quem ataca.
        self.assertEqual(diretivas['script-src'],["'self'",'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'])
        self.assertEqual(diretivas['object-src'],["'none'"])
        self.assertNotIn("'unsafe-inline'",diretivas['script-src'])
        self.assertNotIn("'unsafe-eval'",diretivas['script-src'])
        self.assertIn('https://heveemylixartyijxewh.supabase.co',diretivas['connect-src'])
