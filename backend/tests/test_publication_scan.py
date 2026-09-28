import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def test_publication_scans_google_credentials_and_actual_staged_content(tmp_path):
    root = Path(__file__).resolve().parents[2]
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    shutil.copyfile(root / 'scripts/check-publication.py', scripts / 'check-publication.py')
    def git(*args):
        subprocess.run(['git', '-c', f'safe.directory={tmp_path.as_posix()}', *args], cwd=tmp_path, check=True, capture_output=True)
    git('init')
    oauth = tmp_path / '.data/oauth/google-client.json'
    oauth.parent.mkdir(parents=True)
    secret = 'synthetic-google-client-secret-for-scan'
    oauth.write_text(json.dumps({'installed': {'client_secret': secret}}), encoding='utf-8')
    staged = tmp_path / 'payload.txt'
    staged.write_text(secret, encoding='utf-8')
    git('add', 'payload.txt')
    # Clean working content must not hide a secret already staged for commit.
    staged.write_text('clean', encoding='utf-8')
    environment = {**os.environ, 'SAKUYA_GOOGLE_CLIENT_FILE': str(oauth), 'PYTHONUTF8': '1'}
    result = subprocess.run([sys.executable, str(scripts / 'check-publication.py'), '--staged'], cwd=tmp_path, env=environment, text=True, capture_output=True)
    assert result.returncode == 1, result.stderr
    assert secret not in result.stdout
    findings = json.loads(result.stdout)['findings']
    assert {'source': 'index', 'path': 'payload.txt', 'rule': 'matches-local-credential'} in findings
    (tmp_path / 'client_secret_test.json').write_text('{}')
    git('add', 'payload.txt', 'client_secret_test.json')
    result = subprocess.run([sys.executable, str(scripts / 'check-publication.py'), '--staged'], cwd=tmp_path, env=environment, text=True, capture_output=True)
    assert result.returncode == 1
    assert {'source': 'index', 'path': 'client_secret_test.json', 'rule': 'private-path'} in json.loads(result.stdout)['findings']
