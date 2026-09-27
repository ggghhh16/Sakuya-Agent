"""Administrator-managed Chat Completions compatible providers."""
from urllib.parse import urlparse
from typing import Literal
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from . import db, settings

router = APIRouter(prefix='/api/settings')


class ProviderIn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    id: str | None = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str = Field(default='', max_length=2000)


class ModelIn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    provider_id: str = Field(max_length=100)
    name: str = Field(min_length=1, max_length=150)
    reasoning: bool = False


class DefaultIn(BaseModel):
    model_id: str = Field(max_length=100)


def validate_base(value):
    parsed = urlparse(value)
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('请输入有效的模型 API 根地址')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost'}):
        raise ValueError('远程模型地址必须使用 HTTPS；本机模型可使用 HTTP')
    return value.rstrip('/')


def get_provider(identifier):
    provider = next((p for p in settings.catalog()[0] if p['id'] == identifier), None)
    if not provider:
        raise HTTPException(404, '供应商不存在')
    return provider


@router.post('/providers')
def save_provider(data: ProviderIn):
    base = validate_base(data.base_url)
    with settings.LOCK:
        providers, models, default = settings.catalog()
        old = get_provider(data.id) if data.id else None
        # Never forward a retained secret to a changed destination.
        if old and old['base_url'].rstrip('/') != base and not data.api_key:
            raise ValueError('更换 API 地址时请重新填写密钥')
        key = data.api_key or (old or {}).get('api_key', '')
        if not key:
            raise ValueError('请填写 API Key')
        item = {'id': data.id or db.uid('provider'), 'name': data.name, 'base_url': base, 'api_key': key}
        settings.save_config({'providers': [p for p in providers if p['id'] != item['id']] + [item], 'models': models, 'default_model_id': default})
    return {'id': item['id']}


@router.delete('/providers/{identifier}')
def delete_provider(identifier: str):
    with settings.LOCK:
        get_provider(identifier)
        providers, models, default = settings.catalog()
        models = [m for m in models if m['provider_id'] != identifier]
        if not any(m['id'] == default for m in models):
            default = models[0]['id'] if models else ''
        return settings.save_config({'providers': [p for p in providers if p['id'] != identifier], 'models': models, 'default_model_id': default})


@router.get('/providers/{identifier}/models')
def discover_models(identifier: str):
    provider = get_provider(identifier)
    try:
        with httpx.Client(timeout=20, follow_redirects=False) as client:
            response = client.get(provider['base_url'] + '/models', headers={'Authorization': 'Bearer ' + provider['api_key']})
            response.raise_for_status()
            models = response.json()['data']
            return {'models': sorted({m['id'] for m in models if isinstance(m.get('id'), str) and 0 < len(m['id']) <= 150})[:2000]}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(422, '无法读取模型列表；请检查地址、密钥及 /models 支持情况，也可以手动填写模型 ID')


@router.post('/models')
def add_model(data: ModelIn):
    with settings.LOCK:
        get_provider(data.provider_id)
        providers, models, default = settings.catalog()
        old = next((m for m in models if m['provider_id'] == data.provider_id and m['name'] == data.name), None)
        item = data.model_dump() | {'id': old['id'] if old else db.uid('model')}
        models = [m for m in models if m['id'] != item['id']] + [item]
        return settings.save_config({'providers': providers, 'models': models, 'default_model_id': default or item['id']})


@router.delete('/models/{identifier}')
def delete_model(identifier: str):
    with settings.LOCK:
        providers, models, default = settings.catalog()
        models = [m for m in models if m['id'] != identifier]
        if default == identifier:
            default = models[0]['id'] if models else ''
        return settings.save_config({'providers': providers, 'models': models, 'default_model_id': default})


@router.put('/default-model')
def default_model(data: DefaultIn):
    with settings.LOCK:
        settings.resolve_model(data.model_id)
        providers, models, _ = settings.catalog()
        return settings.save_config({'providers': providers, 'models': models, 'default_model_id': data.model_id})


class SearchIn(BaseModel):
    search_key: str = Field(max_length=2000)


@router.put('/search')
def search_config(data: SearchIn):
    return settings.save_config(data.model_dump())
