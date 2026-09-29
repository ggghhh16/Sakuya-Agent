"""Check publishable files and reachable Git history without printing secret values."""
import json
import os
import re
import subprocess
import sqlite3
import argparse
from pathlib import Path
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", "-c", f"safe.directory={ROOT.as_posix()}", *args], cwd=ROOT)


patterns = {
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider-key": re.compile(rb"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b"),
    "user-home": re.compile(rb"[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s\"'<>\\/]+", re.I),
}
oauth_file = r'(?:google-client|client[_-]secret[^/]*)\.json'
private_path = re.compile(r"(^|/)(?:\.data(?:-[^/]*)?|\.venv|\.tools|\.build|dist(?:-[^/]*)?|release[^/]*|node_modules|test-results|playwright-report|\.codex|__pycache__)(/|$)|\.(?:sqlite3?(?:-.*)?|db(?:-.*)?|pem|key|p12|pfx|lnk|har)$|(^|/)(?:\.env(?:\..*)?|provider\.json|credentials\.json|" + oauth_file + r')$', re.I)
findings = []
local_secrets = set()
parser = argparse.ArgumentParser()
parser.add_argument('--package', type=Path, help='Also scan an unpacked distribution, including binary exact-secret matches')
parser.add_argument('--staged', action='store_true', help='Scan the actual Git index instead of working files')
args = parser.parse_args()


def add_secrets(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r'(?:key|token|secret|password|security_code|security_js_code)$', key, re.I) and isinstance(item, str) and len(item) >= 8:
                local_secrets.add(item.encode())
            elif isinstance(item, (dict, list)):
                add_secrets(item)
    elif isinstance(value, list):
        for item in value:
            add_secrets(item)


user_environment = {}
if os.name == 'nt':
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
        for index in range(winreg.QueryInfoKey(key)[1]):
            name, value, _ = winreg.EnumValue(key, index)
            if isinstance(value, str):
                user_environment[name] = value
project_environment = dotenv_values(ROOT / '.env')
environment = {**user_environment, **project_environment, **os.environ}
# Scan shadowed values too: overriding a key does not make its old value public.
for source in (user_environment, project_environment, os.environ):
    add_secrets(dict(source))
for name in ('SAKUYA_ENV_FILE', 'SAKUYA_CLIENT_ENV_FILE'):
    if environment.get(name) and Path(environment[name]).is_file():
        add_secrets(dotenv_values(environment[name]))
storage_roots = {ROOT / '.data', ROOT / '.data-client'}
for name in ('SAKUYA_DATA_DIR', 'SAKUYA_CLIENT_DATA_DIR'):
    if environment.get(name):
        storage_roots.add(Path(environment[name]))
for name in ('SAKUYA_DESKTOP_DATA', 'SAKUYA_CLIENT_DESKTOP_DATA'):
    if environment.get(name):
        storage_roots.add(Path(environment[name]) / 'workspace')
if environment.get('APPDATA'):
    storage_roots.update(Path(environment['APPDATA']) / name / 'workspace'
                         for name in ('sakuya-agent', 'Sakuya Agent', 'Sakuya Client'))
workspace_dirs = [folder for root in storage_roots if root.is_dir()
                  for folder in (root, *(root / 'users').glob('*')) if folder.is_dir()]
for folder in workspace_dirs:
    if (folder / '.env').is_file():
        add_secrets(dotenv_values(folder / '.env'))
oauth_paths = {folder / 'oauth/google-client.json' for folder in workspace_dirs}
if environment.get('SAKUYA_GOOGLE_CLIENT_FILE'):
    oauth_paths.add(Path(environment['SAKUYA_GOOGLE_CLIENT_FILE']))
for path in oauth_paths:
    if path.is_file():
        add_secrets(json.loads(path.read_text('utf-8-sig')))
for path in (folder / 'provider.json' for folder in workspace_dirs if (folder / 'provider.json').is_file()):
    add_secrets(json.loads(path.read_text('utf-8')))
for path in (folder / 'workspace.sqlite' for folder in workspace_dirs if (folder / 'workspace.sqlite').is_file()):
    con = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if con.execute("SELECT 1 FROM sqlite_master WHERE name='objects'").fetchone():
            for (body,) in con.execute("SELECT body FROM objects WHERE kind IN ('integration_secret', 'map_secret')"):
                add_secrets(json.loads(body))
    finally:
        con.close()


def inspect(label, path, content):
    if any(secret in content for secret in local_secrets):
        findings.append({'source': label, 'path': path, 'rule': 'matches-local-credential'})
    if label != 'package' and path != ".env.example" and private_path.search(path):
        findings.append({"source": label, "path": path, "rule": "private-path"})
    if b"\x00" in content:
        return
    for rule, pattern in patterns.items():
        for match in pattern.finditer(content):
            # Synthetic test credentials are explicitly named and not real provider keys.
            if rule == "provider-key" and match.group().startswith((b"sk-test-", b"sk-dummy-", b"sk-placeholder-")):
                continue
            findings.append({"source": label, "path": path, "line": content[:match.start()].count(b"\n") + 1, "rule": rule})


files = sorted(set(git('ls-files', '--cached', *([] if args.staged else ['--others', '--exclude-standard']), '-z').decode().split('\0')) - {''})
for filename in files:
    path = ROOT / filename
    if args.staged:
        inspect('index', filename, git('show', ':' + filename))
    elif path.is_file():
        inspect("working-tree", filename, path.read_bytes())

objects = {}
for line in git("rev-list", "--objects", "--all").decode().splitlines():
    oid, _, path = line.partition(" ")
    if path:
        objects[oid] = path
history_count = 0
if objects:
    # Use batch reads so history inspection does not start one Git process per file.
    proc = subprocess.run(["git", "-c", f"safe.directory={ROOT.as_posix()}", "cat-file", "--batch"], input=("\n".join(objects) + "\n").encode(), stdout=subprocess.PIPE, check=True, cwd=ROOT)
    data, offset = proc.stdout, 0
    for oid, path in objects.items():
        end = data.index(b"\n", offset)
        _, kind, size = data[offset:end].split()
        size = int(size)
        content = data[end + 1:end + 1 + size]
        offset = end + 1 + size + 1
        if kind == b"blob":
            history_count += 1
            inspect(f"git:{oid[:12]}", path, content)
package_count = 0
if args.package:
    package_root = args.package.resolve(strict=True)
    for path in package_root.rglob('*'):
        if not path.is_file():
            continue
        package_count += 1
        relative = path.relative_to(package_root).as_posix()
        if re.search(r'(^|/)(?:\.env(?:\..*)?|\.data|provider\.json|credentials\.json|' + oauth_file + r'|tests?|test-results)(/|$)|\.(?:sqlite3?(?:-.*)?|db(?:-.*)?|key|p12|pfx|log|har|lnk)$', relative, re.I):
            findings.append({'source': 'package', 'path': relative, 'rule': 'private-path'})
        inspect('package', relative, path.read_bytes())
    # PyInstaller stores Python modules compressed: inspect the decompressed
    # application code too, including co_filename local build path residues.
    from PyInstaller.archive.readers import CArchiveReader
    import types
    archive = CArchiveReader(str(package_root / 'resources/backend/sakuya-service.exe'))
    pyz = archive.open_embedded_archive('PYZ.pyz')
    def inspect_code(name, code):
        inspect('package', name, code.co_filename.encode())
        for constant in code.co_consts:
            if isinstance(constant, str):
                inspect('package', name, constant.encode())
            elif isinstance(constant, bytes):
                inspect('package', name, constant)
            elif isinstance(constant, types.CodeType):
                inspect_code(name, constant)
    for name in pyz.toc:
        if name == 'app' or name.startswith('app.'):
            inspect_code(name, pyz.extract(name))
print(json.dumps({"working_files": len(files), "history_blobs": history_count, "package_files": package_count, "findings": findings}, ensure_ascii=False, indent=2))
raise SystemExit(bool(findings))
