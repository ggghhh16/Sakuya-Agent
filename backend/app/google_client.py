"""Application OAuth identity, separate from each user's authorization tokens."""
import json
import os
from pathlib import Path
from . import db


def client_path():
    configured = os.getenv('SAKUYA_GOOGLE_CLIENT_FILE')
    return Path(configured) if configured else db.DATA / 'oauth' / 'google-client.json'


def parse_client(document):
    client = document.get('installed') if isinstance(document, dict) else None
    if not isinstance(client, dict):
        raise ValueError('需要为 Sakuya 注册的 Google 桌面应用 OAuth 配置')
    identifier, secret = client.get('client_id'), client.get('client_secret', '')
    if not isinstance(identifier, str) or not identifier.endswith('.apps.googleusercontent.com') or len(identifier) > 1000:
        raise ValueError('Google 桌面应用 Client ID 无效')
    if not isinstance(secret, str) or len(secret) > 2000:
        raise ValueError('Google 桌面应用配置无效')
    return {'client_id': identifier, 'client_secret': secret}


def application_client():
    path = client_path()
    if not path.is_file():
        return {}
    try:
        if path.stat().st_size > 50000:
            return {}
        return parse_client(json.loads(path.read_text('utf-8-sig')))
    except (OSError, ValueError, TypeError):
        return {}
