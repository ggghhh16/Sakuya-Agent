"""Account-local building locations and authenticated AMap services."""
import hashlib
import math
import re
import time
from functools import lru_cache
from threading import Lock
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import Field
from . import db, planner
from .settings import private_env
from .map_resolver import RESOLVER_VERSION, extract_location, location_input, match_place, search_queries

router = APIRouter(prefix='/api/maps')
sdk_router = APIRouter(prefix='/_AMapService')


@lru_cache(maxsize=128)
def search_throttle(key_hash):
    return Lock(), [0.0]


class MapConfig(planner.Strict):
    js_key: str = Field(default='', max_length=200, pattern=r'^[A-Za-z0-9_-]*$')
    security_code: str = Field(default='', max_length=200, pattern=r'^[A-Za-z0-9_-]*$')
    web_key: str = Field(default='', max_length=200, pattern=r'^[A-Za-z0-9_-]*$')
    city: str = Field(default='', max_length=100)


def credentials():
    saved = db.get('amap_config', 'map_secret') or {}
    names = {'js_key': 'AMAP_JS_KEY', 'security_code': 'AMAP_SECURITY_JS_CODE', 'web_key': 'AMAP_WEB_KEY'}
    return {**{key: private_env('SAKUYA_' + name) or private_env(name) for key, name in names.items()}, **saved}


@router.get('/config')
def config_status():
    c = credentials()
    return {'configured': bool(c.get('js_key') and c.get('security_code')),
            'search_configured': bool(c.get('web_key')), 'js_key': c.get('js_key', ''),
            'security_code_set': bool(c.get('security_code')), 'web_key_set': bool(c.get('web_key')),
            'city': c.get('city', '')}


@router.put('/config')
def save_config(data: MapConfig):
    with planner.lock:
        changes = {k: v for k, v in data.model_dump().items() if v or k == 'city'}
        if db.get('amap_config', 'map_secret'):
            db.patch('amap_config', changes)
        else:
            db.put('map_secret', {'id': 'amap_config', **changes})
        return config_status()


class Place(planner.Strict):
    name: str = Field(min_length=1, max_length=300)
    address: str = Field(default='', max_length=1000)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    provider: Literal['amap'] = 'amap'
    coord_system: Literal['GCJ-02'] = 'GCJ-02'
    poi_id: str = Field(default='', max_length=100)
    source: Literal['search', 'manual'] = 'manual'


class BindPlace(planner.Strict):
    revision: int = Field(ge=1)
    map_revision: int = Field(default=0, ge=0)
    place: Place | None


class ResolvePlace(planner.Strict):
    revision: int = Field(ge=1)
    map_revision: int = Field(default=0, ge=0)
    force: bool = False


@router.post('/entries/{identifier}/resolve')
def resolve_place(identifier: str, data: ResolvePlace):
    with planner.lock:
        entry = planner.require(identifier, 'planner_entry')
        if entry['revision'] != data.revision or entry.get('map_revision', 0) != data.map_revision:
            raise HTTPException(409, '安排或地点已变更，请刷新后重试')
        original = location_input(entry)
        place = entry.get('map_place')
        if place and place.get('location_text') == original[0] and (not place.get('auto_input') or place['auto_input'] == original) and (not data.force or not place.get('auto_input')):
            return entry
        c = credentials()
        # Include service configuration so fixing a key invalidates a failed lookup.
        config_key = hashlib.sha256(f"{RESOLVER_VERSION}|{c.get('web_key', '')}|{c.get('city', '')}".encode()).hexdigest()
        cached = entry.get('map_resolution') or {}
        if not data.force and cached.get('input') == original and cached.get('config_key') == config_key and cached.get('expires', 0) > time.time():
            return entry
    query = extract_location(entry)
    attempted_queries = []
    place, status, message = None, 'no_location', ''
    if query:
        if not c.get('web_key'):
            status = 'unconfigured'
        else:
            try:
                for keyword in search_queries(query):
                    attempted_queries.append(keyword)
                    place, status = match_place(query, search(q=keyword, city=c.get('city', ''))['places'])
                    if status != 'not_found':
                        break
            except HTTPException as exc:
                status, message = 'error', str(exc.detail)
    if place:
        place = {**place, 'location_text': original[0], 'auto_input': original}
    resolution = {'input': original, 'query': query, 'queries': attempted_queries, 'status': status, 'message': message,
                  'config_key': config_key, 'expires': time.time() + (60 if status == 'error' else 86400)}
    # Network work must not hold the planner lock. Reject late results after an
    # edit, sync, manual correction, deletion, or configuration change.
    with planner.lock:
        current = planner.require(identifier, 'planner_entry')
        current_config = credentials()
        if (current['revision'] != data.revision or current.get('map_revision', 0) != data.map_revision
                or location_input(current) != original
                or current_config.get('web_key') != c.get('web_key') or current_config.get('city') != c.get('city')):
            raise HTTPException(409, '安排或地点已变更，请刷新后重试')
        return db.patch(identifier, {'map_place': place, 'map_resolution': resolution, 'map_revision': data.map_revision + 1})


@router.put('/entries/{identifier}/place')
def bind_place(identifier: str, data: BindPlace):
    # Coordinates are a local annotation, including on read-only remote events.
    # They do not advance the planner revision or mark remote content dirty.
    with planner.lock:
        entry = planner.require(identifier, 'planner_entry')
        if entry['revision'] != data.revision or entry.get('map_revision', 0) != data.map_revision:
            raise HTTPException(409, '安排或地点已变更，请刷新后重试')
        place = data.place.model_dump() if data.place else None
        if place:
            place['location_text'] = entry.get('location', '')
            saved = data.place.model_dump()
            identity = hashlib.sha256(f"{saved['name']}|{saved['lng']}|{saved['lat']}".encode()).hexdigest()[:24]
            identifier_place = 'map_place_' + identity
            if db.get(identifier_place, 'map_place'):
                db.patch(identifier_place, saved)
            else:
                db.put('map_place', {'id': identifier_place, **saved})
        return db.patch(identifier, {'map_place': place, 'map_revision': data.map_revision + 1})


@router.get('/places')
def saved_places():
    return db.all_items('map_place')[:100]


def amap_get(url, params):
    try:
        with httpx.Client(timeout=12, follow_redirects=False) as client:
            with client.stream('GET', url, params=params) as response:
                if response.status_code != 200:
                    raise HTTPException(502, '地图服务暂时不可用，请稍后重试')
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 2_000_000:
                        raise HTTPException(502, '地图服务响应过大')
                return bytes(body), response.headers.get('content-type', 'application/json')
    except httpx.HTTPError:
        # Never expose request URLs: they contain service credentials.
        raise HTTPException(502, '无法连接高德地图，请检查网络后重试') from None


@router.get('/search')
def search(q: str = Query(min_length=1, max_length=200), city: str = Query(default='', max_length=100)):
    import json
    c = credentials()
    if not c.get('web_key'):
        raise HTTPException(409, '请先配置高德 Web 服务 Key')
    params = {'key': c['web_key'], 'keywords': q, 'page_size': '12', 'page_num': '1'}
    region = city.strip() or c.get('city', '')
    if region:
        params.update(region=region, city_limit='true')
    # Campus lookups can need alternate building names. Pace them across entries
    # and browser windows sharing a credential instead of exhausting its QPS.
    throttle, last = search_throttle(hashlib.sha256(c['web_key'].encode()).hexdigest())
    with throttle:
        delay = 1.05 - (time.monotonic() - last[0])
        if delay > 0:
            time.sleep(delay)
        last[0] = time.monotonic()
        body, _ = amap_get('https://restapi.amap.com/v5/place/text', params)
    try:
        result = json.loads(body)
    except (ValueError, UnicodeError):
        raise HTTPException(502, '地图服务返回了无效数据') from None
    if not isinstance(result, dict) or str(result.get('status')) != '1':
        raise HTTPException(502, '地点搜索失败，请检查 Key、服务权限或配额')
    pois = result.get('pois', [])
    if not isinstance(pois, list):
        raise HTTPException(502, '地图服务返回了无效数据')
    places = []
    for poi in pois[:12]:
        if not isinstance(poi, dict):
            continue
        try:
            coordinates = poi.get('location')
            if not isinstance(coordinates, str):
                continue
            lng, lat = map(float, coordinates.split(','))
            if not math.isfinite(lng) or not math.isfinite(lat):
                continue
            address = ' '.join(str(poi.get(k) or '') for k in ('pname', 'cityname', 'adname', 'address')).strip()
            places.append(Place(name=poi['name'], address=address, lng=lng, lat=lat, poi_id=poi.get('id') or '', source='search').model_dump())
        except (KeyError, TypeError, ValueError):
            continue
    return {'places': places}


@router.get('/_AMapService/{path:path}')
@sdk_router.get('/{path:path}')
def sdk_proxy(path: str, request: Request):
    # Fixed SDK endpoints only, never arbitrary URLs.
    upstream = {'v4/map/styles': 'https://webapi.amap.com/v4/map/styles',
                'v3/log/init': 'https://restapi.amap.com/v3/log/init',
                'v3/assistant/coordinate/convert': 'https://restapi.amap.com/v3/assistant/coordinate/convert'}.get(path)
    if not upstream:
        raise HTTPException(404, '不支持的地图服务')
    c = credentials()
    if not c.get('js_key') or not c.get('security_code'):
        raise HTTPException(409, '请先配置高德地图')
    params = dict(request.query_params)
    callback = params.get('callback', '')
    if callback and not re.fullmatch(r'[A-Za-z_$][A-Za-z0-9_$]{0,100}', callback):
        raise HTTPException(400, '不支持的地图回调')
    if path == 'v3/assistant/coordinate/convert':
        # This feature converts one device GPS fix, never arbitrary API requests.
        try:
            lng, lat = map(float, params.get('locations', '').split(','))
            valid = math.isfinite(lng) and math.isfinite(lat) and -180 <= lng <= 180 and -90 <= lat <= 90
        except (TypeError, ValueError):
            valid = False
        if not valid or params.get('coordsys') != 'gps':
            raise HTTPException(400, '无效设备坐标')
    params.update(key=c['js_key'], jscode=c['security_code'])
    body, content_type = amap_get(upstream, params)
    # AMap's initialization JSONP is served as octet-stream upstream.
    # Keep nosniff enabled and label only the fixed endpoint's JSONP correctly.
    if path in {'v3/log/init', 'v3/assistant/coordinate/convert'} and callback:
        content_type = 'application/javascript'
    return Response(body, media_type=content_type.split(';')[0])
