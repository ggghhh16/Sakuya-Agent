"""Query PyPI's published vulnerabilities for locked and installed versions."""
import concurrent.futures
import importlib.metadata
import json
from pathlib import Path
import urllib.request

root = Path(__file__).resolve().parents[1]
versions = {(d.metadata['Name'], d.version) for d in importlib.metadata.distributions()}
for line in (root / 'backend/requirements.lock.txt').read_text().splitlines():
    if '==' in line:
        versions.add(tuple(line.split('==', 1)))
# Names differing only by underscores/case identify the same PyPI project.
versions = sorted({(name.lower().replace('_', '-'), version) for name, version in versions})


def inspect(item):
    name, version = item
    try:
        with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json', timeout=30) as response:
            value = json.load(response)
        return {'name': name, 'version': version, 'vulnerabilities': [
            {'id': v['id'], 'aliases': v.get('aliases', []), 'fixed_in': v.get('fixed_in', []), 'link': v.get('link')}
            for v in value.get('vulnerabilities', []) if not v.get('withdrawn')]}
    except Exception as exc:
        return {'name': name, 'version': version, 'error': type(exc).__name__}


with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    results = list(pool.map(inspect, versions))
failures = [v for v in results if v.get('error') or v.get('vulnerabilities')]
print(json.dumps({'source': 'PyPI JSON API', 'versions_checked': len(results), 'findings': failures}, indent=2))
raise SystemExit(bool(failures))
