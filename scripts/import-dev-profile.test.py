import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('import_dev', Path(__file__).with_name('import-dev-profile.py'))
import_dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(import_dev)


class ImportDevTests(unittest.TestCase):
    def test_online_database_backup_preserves_wal_and_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            live = sqlite3.connect(source / 'messages.db')
            live.execute('PRAGMA journal_mode=WAL')
            live.execute('CREATE TABLE messages(id TEXT PRIMARY KEY, text TEXT)')
            live.execute("INSERT INTO messages VALUES('m1', 'fixture conversation')")
            live.commit()
            before = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir() if not p.name.endswith('-shm')}
            (source / 'server.lease').write_text('private live lock')
            (source / 'credentials.bin').write_bytes(b'not a provider credential')
            (source / 'external-link').symlink_to(root)
            receipt = import_dev.snapshot(source, root / 'copy')
            with sqlite3.connect(root / 'copy/messages.db') as copied:
                self.assertEqual(copied.execute('SELECT text FROM messages').fetchone()[0], 'fixture conversation')
            self.assertEqual(receipt['databases'], ['messages.db'])
            self.assertFalse((root / 'copy/server.lease').exists())
            self.assertFalse((root / 'copy/credentials.bin').exists())
            self.assertFalse((root / 'copy/external-link').exists())
            for name, digest in before.items():
                self.assertEqual(hashlib.sha256((source / name).read_bytes()).hexdigest(), digest)
            live.close()

    def test_import_preserves_agents_and_settings_without_resuming_automations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'original'
            target = root / 'copy'
            target.mkdir()
            bots = [{'id': 'scout', 'name': 'Scout', 'cwd': str(source / 'bots/scout'), 'resumeCursors': {'engine': 'production-session'}, 'tasks': [{'id': 'task', 'resumeCursors': {'engine': 'task-session'}}]}]
            (target / 'bots.json').write_text(json.dumps(bots))
            (target / 'config.json').write_text(json.dumps({'onboarding': {'done': True}}))
            (target / 'routines.json').write_text(json.dumps({'routines': [{'id': 'morning', 'enabled': True, 'nextRunAt': 1}]}))
            receipt = import_dev.prepare_data(target, source)
            saved = json.loads((target / 'bots.json').read_text())[0]
            self.assertEqual(saved['id'], 'scout')
            self.assertEqual(saved['cwd'], str(target / 'bots/scout'))
            self.assertEqual(saved['resumeCursors'], {})
            self.assertEqual(saved['tasks'][0]['resumeCursors'], {})
            self.assertTrue(json.loads((target / 'config.json').read_text())['onboarding']['done'])
            routine = json.loads((target / 'routines.json').read_text())['routines'][0]
            self.assertFalse(routine['enabled'])
            self.assertIsNone(routine['nextRunAt'])
            self.assertEqual(receipt, {'bots': 1, 'routines_paused': 1})


if __name__ == '__main__':
    unittest.main()
