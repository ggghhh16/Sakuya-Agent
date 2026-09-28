"""Install the application's desktop OAuth identity; never prints credentials."""
import argparse
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'backend'))
parser = argparse.ArgumentParser(description='配置 Sakuya 的 Google 桌面应用身份，不导入个人授权令牌')
parser.add_argument('client_file', type=Path, help='为 Sakuya 下载的 Google 桌面应用 OAuth JSON')
parser.add_argument('--data-dir', type=Path, default=root / '.data')
args = parser.parse_args()
os.environ['SAKUYA_DATA_DIR'] = str(args.data_dir.resolve())
from app.google_client import parse_client
from app.private_storage import protect

try:
    source = args.client_file.resolve(strict=True)
    if source.stat().st_size > 50000:
        raise ValueError('配置文件过大')
    client = parse_client(json.loads(source.read_text('utf-8-sig')))
    folder = args.data_dir.resolve() / 'oauth'
    folder.mkdir(parents=True, exist_ok=True)
    protect(folder)
    destination = folder / 'google-client.json'
    temporary = folder / 'google-client.pending'
    temporary.write_text(json.dumps({'installed': client}), encoding='utf-8')
    protect(temporary)
    temporary.replace(destination)
    print('Google application configuration: SET. User authorization remains separate.')
except (OSError, ValueError) as exc:
    print('无法安装 Google 桌面应用配置，请检查文件类型和访问权限。', file=sys.stderr)
    raise SystemExit(1) from None
