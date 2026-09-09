import tempfile,unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_site
class PacoteTest(unittest.TestCase):
    def test_publica_so_lista_explicita_sem_banco_ou_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            build_site.build(d)
            files={p.name for p in Path(d).iterdir()}
            self.assertEqual(files,set(build_site.FILES))
            self.assertNotIn('scripts',files)
            self.assertNotIn('tests',files)
            self.assertNotIn('DRE_DATA',(Path(d)/'data.js').read_text())
    def test_nao_mistura_pacote_com_arquivos_anteriores(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'arquivo-privado.json';p.write_text('{}')
            with self.assertRaises(ValueError):build_site.build(d)
            self.assertTrue(p.exists())
