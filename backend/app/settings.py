import json
import os
import threading
from pathlib import Path
from dotenv import load_dotenv
from .db import DATA
from . import db

load_dotenv(Path(os.getenv('SAKUYA_ENV_FILE', str(Path(__file__).resolve().parents[2] / '.env'))))
CONFIG = DATA / 'provider.json'
LOCK = threading.RLock()
DEFAULT_HOSTS = 'docs.langchain.com,github.com,raw.githubusercontent.com,api.github.com,arxiv.org,export.arxiv.org,docs.python.org,fastapi.tiangolo.com,react.dev,developer.mozilla.org'


def config_path():
    return db.data_dir() / 'provider.json' if db.current_owner() else CONFIG


def private_env(name, default=''):
    return default if db.current_owner() else os.getenv(name, default)


def read_saved():
    path = config_path()
    return json.loads(path.read_text('utf-8')) if path.exists() else {}


def catalog():
    saved = read_saved()
    if 'providers' in saved:
        return saved.get('providers', []), saved.get('models', []), saved.get('default_model_id', '')
    # Expose the existing configuration without copying secrets to the browser.
    model = saved.get('model') or private_env('MODEL_NAME', '')
    key = saved.get('api_key') or private_env('MODEL_API_KEY') or private_env('OPENAI_API_KEY', '')
    if not model and not key:
        return [], [], ''
    providers = [{'id': 'legacy', 'name': '原有供应商', 'base_url': saved.get('base_url') or private_env('MODEL_BASE_URL', 'https://api.openai.com/v1'), 'api_key': key}]
    models = [{'id': 'legacy-model', 'provider_id': 'legacy', 'name': model, 'reasoning': False}] if model else []
    return providers, models, 'legacy-model' if model else ''


def config():
    saved = read_saved()
    result = {
        'api_key': saved.get('api_key') or private_env('MODEL_API_KEY') or private_env('OPENAI_API_KEY', ''),
        'base_url': saved.get('base_url') or private_env('MODEL_BASE_URL', 'https://api.openai.com/v1'),
        'model': saved.get('model') or private_env('MODEL_NAME', ''),
        'search_key': saved.get('search_key') or private_env('TAVILY_API_KEY', ''),
        'github_token': private_env('GITHUB_TOKEN', ''),
    }
    if 'providers' in saved:
        providers, models, default = catalog()
        model = next((m for m in models if m['id'] == default), None)
        provider = next((p for p in providers if model and p['id'] == model['provider_id']), None)
        result.update(api_key=provider['api_key'] if provider else '', base_url=provider['base_url'] if provider else '', model=model['name'] if model else '')
    return result


def resolve_model(identifier=None, effort='default'):
    providers, models, default = catalog()
    selected = next((m for m in models if m['id'] == (identifier or default)), None)
    if not selected:
        raise ValueError('所选模型已移除，请在设置中添加模型并重新选择')
    provider = next((p for p in providers if p['id'] == selected['provider_id']), None)
    if not provider or not provider.get('api_key'):
        raise ValueError('所选模型的供应商未配置密钥')
    if effort != 'default' and not selected.get('reasoning'):
        raise ValueError('该模型未启用思考强度支持，请使用默认强度')
    return {'model_id': selected['id'], 'provider_id': provider['id'], 'model_name': selected['name'], 'reasoning_effort': effort}


def config_for_run(run):
    result = config()
    if run and run.get('provider_id'):
        provider = next((p for p in catalog()[0] if p['id'] == run['provider_id']), None)
        if not provider:
            raise ValueError('本条消息使用的供应商已移除，请重新选择模型')
        result.update(api_key=provider['api_key'], base_url=provider['base_url'], model=run['model_name'])
    return result


def reasoning_payload(run):
    effort = (run or {}).get('reasoning_effort', 'default')
    return {'reasoning_effort': effort} if effort != 'default' else {}


def public_config():
    c = config()
    providers, models, default = catalog()
    return {'base_url': c['base_url'], 'model': c['model'], 'model_configured': bool(c['api_key'] and c['model']),
            'providers': [{k: v for k, v in p.items() if k != 'api_key'} | {'configured': bool(p.get('api_key'))} for p in providers],
            'models': models, 'default_model_id': default,
            'search_configured': bool(c['search_key']), 'github_configured': bool(c['github_token']),
            'allowed_hosts': os.getenv('RESEARCH_ALLOWED_HOSTS', DEFAULT_HOSTS).split(','),
            'storage': 'SQLite · 本机工作区', 'version': '0.1.0'}


def save_config(values):
    with LOCK:
        saved = read_saved()
        for key, value in values.items():
            if key in ('base_url', 'model', 'providers', 'models', 'default_model_id') or value:
                saved[key] = value
        path = config_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix('.tmp')
        temp.write_text(json.dumps(saved, ensure_ascii=False), 'utf-8')
        temp.replace(path)
    return public_config()
