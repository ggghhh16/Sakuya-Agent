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


def test_publication_scans_client_secrets_and_blocks_client_generated_files(tmp_path):
    root = Path(__file__).resolve().parents[2]
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    shutil.copyfile(root / 'scripts/check-publication.py', scripts / 'check-publication.py')
    command = ['git', '-c', f'safe.directory={tmp_path.as_posix()}']
    subprocess.run([*command, 'init'], cwd=tmp_path, check=True, capture_output=True)
    client = tmp_path / '.data-client'
    client.mkdir()
    secret = 'synthetic-client-map-security-for-publication'
    (client / 'provider.json').write_text(json.dumps({'security_code': secret}), encoding='utf-8')
    (client / 'notes.txt').write_text('private workspace')
    custom_secret = 'synthetic-client-custom-env-secret-for-publication'
    old_secret = 'synthetic-shadowed-secret-for-publication'
    custom_env = tmp_path / 'custom.env'
    custom_env.write_text('MODEL_API_KEY=' + custom_secret, encoding='utf-8')
    (tmp_path / '.env').write_text('MODEL_API_KEY=' + old_secret, encoding='utf-8')
    for name, value in [('payload.txt', secret), ('custom.txt', custom_secret), ('shadowed.txt', old_secret)]:
        (tmp_path / name).write_text(value, encoding='utf-8')
    subprocess.run([*command, 'add', 'payload.txt', 'custom.txt', 'shadowed.txt', '.data-client/notes.txt'], cwd=tmp_path, check=True, capture_output=True)
    result = subprocess.run([sys.executable, str(scripts / 'check-publication.py'), '--staged'],
                            cwd=tmp_path, env={**os.environ, 'PYTHONUTF8': '1', 'APPDATA': str(tmp_path / 'appdata'),
                                              'SAKUYA_CLIENT_ENV_FILE': str(custom_env), 'MODEL_API_KEY': 'synthetic-override-for-test'}, text=True, capture_output=True)
    assert result.returncode == 1, result.stderr
    assert secret not in result.stdout
    assert custom_secret not in result.stdout and old_secret not in result.stdout
    findings = json.loads(result.stdout)['findings']
    assert {'source': 'index', 'path': 'payload.txt', 'rule': 'matches-local-credential'} in findings
    assert {'source': 'index', 'path': 'custom.txt', 'rule': 'matches-local-credential'} in findings
    assert {'source': 'index', 'path': 'shadowed.txt', 'rule': 'matches-local-credential'} in findings
    assert {'source': 'index', 'path': '.data-client/notes.txt', 'rule': 'private-path'} in findings
