"""Distribution identity. Frozen builds use their bundled marker, never an env override."""
import json
import os
import sys
from pathlib import Path


def distribution():
    if getattr(sys, 'frozen', False):
        marker = Path(sys.executable).with_name('edition.json')
        return json.loads(marker.read_text('utf-8'))['edition'] if marker.exists() else 'dev'
    return os.getenv('SAKUYA_EDITION', 'dev')


EDITION = distribution()
if EDITION not in ('dev', 'client'):
    raise RuntimeError('Unknown Sakuya edition')
IS_CLIENT = EDITION == 'client'
LOCAL_USER = {'id': 'local-client', 'email': '', 'username': 'Local', 'role': 'admin'}
