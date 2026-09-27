"""Check publishable files and reachable Git history without printing secret values."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", "-c", f"safe.directory={ROOT.as_posix()}", *args], cwd=ROOT)


patterns = {
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "provider-key": re.compile(rb"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b"),
    "user-home": re.compile(rb"[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s\"'<>\\/]+", re.I),
}
private_path = re.compile(r"(^|/)(?:\.data|\.venv|node_modules|test-results|playwright-report|\.codex)(/|$)|\.(?:sqlite(?:-.*)?|db|pem|key|p12|pfx|lnk)$|(^|/)\.env(?:\..*)?$", re.I)
findings = []


def inspect(label, path, content):
    if path != ".env.example" and private_path.search(path):
        findings.append({"source": label, "path": path, "rule": "private-path"})
    if b"\x00" in content:
        return
    for rule, pattern in patterns.items():
        for match in pattern.finditer(content):
            # Synthetic test credentials are explicitly named and not real provider keys.
            if rule == "provider-key" and match.group().startswith((b"sk-test-", b"sk-dummy-", b"sk-placeholder-")):
                continue
            findings.append({"source": label, "path": path, "line": content[:match.start()].count(b"\n") + 1, "rule": rule})


files = sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""})
for filename in files:
    path = ROOT / filename
    if path.is_file():
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
print(json.dumps({"working_files": len(files), "history_blobs": history_count, "findings": findings}, ensure_ascii=False, indent=2))
raise SystemExit(bool(findings))
