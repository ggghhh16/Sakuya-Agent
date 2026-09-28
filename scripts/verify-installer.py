"""Compare every installed payload file with the tested unpacked distribution."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('installer', type=Path)
parser.add_argument('unpacked', type=Path)
parser.add_argument('--sevenzip', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
root = Path.cwd().resolve()
output = args.output.resolve()
assert output.is_relative_to(root / '.build') and not output.exists(), 'Use a new directory inside .build'
output.mkdir(parents=True)
subprocess.run([str(args.sevenzip.resolve()), 'x', str(args.installer.resolve()), '-o' + str(output), '-y'], check=True, capture_output=True)

def hashes(folder):
    result = {}
    for path in folder.rglob('*'):
        if path.is_file():
            with path.open('rb') as stream:
                result[path.relative_to(folder).as_posix()] = hashlib.file_digest(stream, 'sha256').hexdigest()
    return result

expected, actual = hashes(args.unpacked.resolve()), hashes(output)
missing = [name for name in expected if actual.get(name) != expected[name]]
assert not missing, f'Installer payload mismatch: {missing}'
extra = sorted(set(actual) - set(expected))
assert not extra, f'Unexpected installed files: {extra}'
with args.installer.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
result = {'verified': True, 'files': len(expected), 'sha256': digest, 'installer': str(args.installer), 'payload': str(args.output)}
args.installer.with_suffix('.validation.json').write_text(json.dumps(result, indent=2) + '\n', 'utf-8')
print(json.dumps(result))
