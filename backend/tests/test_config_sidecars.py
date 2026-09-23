import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from app.services import config_store


class ConfigSidecarTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        for name, value in (
            ('_DATA_DIR', folder.name),
            ('_CONFIG_FILE', str(self.folder / 'config.enc')),
            ('_cache', None),
        ):
            patcher = patch.object(config_store, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_failed_migration_keeps_the_original_for_retry(self):
        history = [{'id': 'saved-scan'}]
        config_store.save({'scan_history': history, 'preferences': {'language': 'en'}})
        replace = config_store.os.replace

        def fail_sidecar(source, target):
            if str(target).endswith('scan_history.json'):
                raise OSError('disk full')
            return replace(source, target)

        with patch.object(config_store.os, 'replace', side_effect=fail_sidecar):
            self.assertEqual(config_store.get('scan_history'), history)
            self.assertEqual(config_store.load().get('scan_history'), history)
        self.assertEqual(config_store.get('scan_history'), history)
        self.assertNotIn('scan_history', config_store.load())
        self.assertEqual(config_store.load()['preferences'], {'language': 'en'})
        self.assertEqual(json.loads((self.folder / 'scan_history.json').read_text()), history)

    def test_failed_save_is_reported_and_preserves_previous_results(self):
        config_store.put('last_scan', {'gaps': [1]})
        with patch.object(config_store.os, 'replace', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                config_store.put('last_scan', {'gaps': [2]})
        self.assertEqual(config_store.get('last_scan'), {'gaps': [1]})

    def test_concurrent_writes_leave_a_complete_file(self):
        values = [{'scan': i, 'gaps': list(range(1000))} for i in range(20)]
        with self.assertNoLogs(config_store.logger, level='WARNING'), ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda value: config_store.put('last_scan', value), values))
        self.assertIn(config_store.get('last_scan'), values)
        self.assertFalse(list(self.folder.glob('*.tmp')))
