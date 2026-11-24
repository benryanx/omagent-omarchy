#!/usr/bin/env python3
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import uuid

SKIP_DIRS = {'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'server-compile-cache', 'logs'}
SKIP_FILES = {'LOCK', 'sessions.json', 'sessions.json.open', 'browser-engine-key', 'credentials.bin', 'Cookies', 'Cookies-journal', 'DIPS', 'DIPS-wal', 'DIPS-shm', 'SharedStorage', 'SharedStorage-wal', 'SharedStorage-shm', 'cua-connection.json', 'cua-local-control.json', 'computer-sharing.json', 'company-connection.bin', 'company-library.bin', 'company-backup-schedule.bin', 'cloud-account.bin', 'cloud-account-staging.bin', 'environments.json', 'environments-staging.json', 'home-place.json', 'own-home.json', 'own-home-choice.json', 'own-home-send.json', 'one-home.json', 'cloud-send.json', 'open-at-login.json'}


def excluded(name):
    return name in SKIP_FILES or name.startswith('Singleton') or name.endswith(('-wal', '-shm', '.lease', '.sock', '.tmp', '.json.open'))


def snapshot(source, target):
    copied = 0
    databases = []
    target.mkdir(mode=0o700)
    for parent, directories, files in os.walk(source, followlinks=False):
        directories[:] = [d for d in directories if d not in SKIP_DIRS and not d.endswith('-server-child') and not (Path(parent) / d).is_symlink()]
        destination = target / Path(parent).relative_to(source)
        destination.mkdir(parents=True, exist_ok=True, mode=0o700)
        for name in files:
            original = Path(parent) / name
            if excluded(name) or original.is_symlink() or not stat.S_ISREG(original.stat().st_mode):
                continue
            output = destination / name
            with original.open('rb') as handle:
                sqlite = handle.read(16) == b'SQLite format 3\x00'
            if sqlite:
                before = sqlite3.connect(original.as_uri() + '?mode=ro', uri=True)
                after = sqlite3.connect(output)
                try:
                    before.backup(after)
                    if after.execute('PRAGMA quick_check').fetchone() != ('ok',):
                        raise RuntimeError('A copied database failed validation')
                finally:
                    before.close()
                    after.close()
                databases.append(str(original.relative_to(source)))
            else:
                shutil.copyfile(original, output)
            output.chmod(0o600)
            copied += 1
    return {'files': copied, 'databases': databases}


def prepare_data(target, source):
    def remap(value):
        if isinstance(value, dict):
            return {k: remap(v) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v) for v in value]
        if isinstance(value, str) and (value == str(source) or value.startswith(str(source) + '/')):
            return str(target) + value[len(str(source)):]
        return value

    for file in target.rglob('*.json'):
        try:
            value = json.loads(file.read_text())
        except (ValueError, UnicodeDecodeError):
            continue
        migrated = remap(value)
        if migrated != value:
            file.write_text(json.dumps(migrated, ensure_ascii=False, indent=2) + '\n')
    config_file = target / 'config.json'
    config = json.loads(config_file.read_text()) if config_file.exists() else {}
    config['cacheKeepWarm'] = {'enabled': False}
    config['context'] = {**config.get('context', {}), 'autoCompact': False}
    config_file.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    disabled = 0
    for name in ['routines.json', 'owner-routines.json']:
        file = target / name
        if not file.exists():
            continue
        value = json.loads(file.read_text())
        for routine in value.get('routines', []):
            if isinstance(routine, dict):
                disabled += routine.get('enabled') is True
                routine['enabled'] = False
                routine['nextRunAt'] = None
                routine.pop('heldFor', None)
        file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    bots_file = target / 'bots.json'
    bots = json.loads(bots_file.read_text()) if bots_file.exists() else []
    for bot in bots:
        bot['resumeCursors'] = {}
        bot['cacheKeepWarm'] = False
        bot['memoryUpkeep'] = False
        for task in bot.get('tasks', []):
            task['resumeCursors'] = {}
    if bots_file.exists():
        bots_file.write_text(json.dumps(bots, ensure_ascii=False, indent=2) + '\n')
    (target / 'environment-id').write_text(str(uuid.uuid4()) + '\n')
    return {'bots': len(bots), 'routines_paused': disabled}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-data', type=Path, required=True)
    parser.add_argument('--source-profile', type=Path, required=True)
    parser.add_argument('--root', type=Path, required=True)
    options = parser.parse_args()
    source_data, source_profile, root = [p.expanduser().resolve() for p in [options.source_data, options.source_profile, options.root]]
    for source in [source_data, source_profile]:
        if not source.is_dir() or root == source or source in root.parents or root in source.parents:
            raise RuntimeError('Source and destination must be separate existing directories')
    if (root / 'data').exists() or (root / 'profile').exists():
        raise RuntimeError('Dev already has a workspace; refusing to overwrite it')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = root / 'imports' / stamp
    backup.mkdir(parents=True, mode=0o700)
    receipt = {'at': stamp, 'source_data': str(source_data), 'source_profile': str(source_profile), 'backup': str(backup)}
    receipt['data_snapshot'] = snapshot(source_data, backup / 'data')
    receipt['profile_snapshot'] = snapshot(source_profile, backup / 'profile')
    shutil.copytree(backup / 'data', root / 'data')
    shutil.copytree(backup / 'profile', root / 'profile')
    receipt['import'] = prepare_data(root / 'data', source_data)
    receipt['automation_paused'] = True
    (root / 'import-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    (root / 'import-receipt.json').chmod(0o600)
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    os.umask(0o077)
    main()
