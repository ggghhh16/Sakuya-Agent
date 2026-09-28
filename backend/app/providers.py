import base64
import ipaddress
import json
import os
import re
import socket
import time
from urllib.parse import urlparse, quote
from urllib.request import getproxies, proxy_bypass
import httpx
from bs4 import BeautifulSoup
from .settings import config, DEFAULT_HOSTS


def validate_url(url):
    source_destination(url)
    return url


def source_destination(url):
    parsed = urlparse(url)
    allowed = {x.strip().lower() for x in os.getenv('RESEARCH_ALLOWED_HOSTS', DEFAULT_HOSTS).split(',')}
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('资料链接必须使用 HTTPS，且不能包含用户名、密码或自定义端口')
    host = (parsed.hostname or '').lower()
    if host not in allowed:
        raise ValueError(f'资料域名尚未允许：{host}')
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if host in {'localhost', 'localhost.localdomain'} or (address and not address.is_global):
        raise ValueError('不允许访问本机或私有网络资料地址')
    # A trusted, administrator-configured HTTPS proxy resolves the public host remotely.
    # Fake-IP DNS on proxy-based networks must not be treated as a direct destination.
    proxies = getproxies()
    proxy = (proxies.get('https') or proxies.get('all')) if not proxy_bypass(host) else None
    if proxy:
        # Use exactly the proxy whose presence justified skipping local DNS.
        return url, proxy, {}
    addresses = [info[4][0] for info in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError('不允许访问本机或私有网络资料地址')
    # Pin the validated address: a second DNS lookup must not change the target.
    destination = str(httpx.URL(url).copy_with(host=addresses[0]))
    return destination, None, {'sni_hostname': host}


def fetch_source(url):
    for _ in range(4):
        destination, proxy, extensions = source_destination(url)
        headers = {'User-Agent': 'SakuyaResearch/0.1', 'Host': urlparse(url).hostname}
        with httpx.Client(timeout=20, follow_redirects=False, trust_env=False, proxy=proxy) as client:
            with client.stream('GET', destination, headers=headers, extensions=extensions) as response:
                if response.is_redirect:
                    from urllib.parse import urljoin
                    url = urljoin(url, response.headers.get('location', ''))
                    continue
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes(chunk_size=65536):
                    body.extend(chunk)
                    if len(body) > 2_000_000:
                        raise ValueError('资料超过 2 MB 读取上限')
                content_type = response.headers.get('content-type', '')
                if not any(x in content_type for x in ('text/', 'json', 'xml')):
                    raise ValueError('当前仅支持网页、文本与 JSON 资料')
                text = body.decode('utf-8', errors='replace')
                if 'html' in content_type:
                    soup = BeautifulSoup(text, 'html.parser')
                    title = soup.title.get_text(' ', strip=True) if soup.title else urlparse(url).hostname
                    for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
                        tag.decompose()
                    text = soup.get_text('\n', strip=True)
                else:
                    title = url.rsplit('/', 1)[-1]
                return {'title': title, 'url': url, 'content': text[:22000], 'type': 'web'}
    raise ValueError('资料链接重定向次数过多')


def search(query):
    key = config()['search_key']
    if not key:
        return []
    with httpx.Client(timeout=30, trust_env=True) as client:
        r = client.post('https://api.tavily.com/search', json={'api_key': key, 'query': query, 'max_results': 4, 'include_raw_content': False})
        r.raise_for_status()
        return [{'title': v['title'], 'url': v['url'], 'content': v.get('content', '')[:10000], 'type': 'search_excerpt'} for v in r.json().get('results', [])]


def github_sources(repository, prompt):
    match = re.fullmatch(r'https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?', repository.strip())
    if not match:
        raise ValueError('仓库地址应为 https://github.com/owner/repo')
    owner, repo = match.groups()
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'SakuyaAgent/0.1'}
    if config()['github_token']:
        headers['Authorization'] = f"Bearer {config()['github_token']}"
    root = f'https://api.github.com/repos/{owner}/{repo}'
    sources = []
    with httpx.Client(timeout=25, headers=headers, trust_env=True) as client:
        meta = client.get(root)
        meta.raise_for_status()
        branch = meta.json()['default_branch']
        ref_response = client.get(f'{root}/commits/{quote(branch, safe="")}')
        ref_response.raise_for_status()
        sha = ref_response.json()['sha']
        tree_response = client.get(f'{root}/git/trees/{sha}', params={'recursive': '1'})
        tree_response.raise_for_status()
        tree = tree_response.json()
        candidates = [v['path'] for v in tree.get('tree', []) if v['type'] == 'blob' and v.get('size', 0) < 60000 and v['path'].endswith(('.py', '.ts', '.tsx', '.md', '.toml', '.json')) and not any(s in v['path'] for s in ('lock', 'node_modules', 'vendor/', 'dist/'))]
        words = set(re.findall(r'[a-zA-Z_]{3,}', prompt.lower()))
        candidates.sort(key=lambda p: (sum(w in p.lower() for w in words) * 3 + ('readme' in p.lower()) * 2), reverse=True)
        paths = candidates[:5]
        sources.append({'title': f'{owner}/{repo} · 仓库文件目录', 'url': repository, 'content': f'固定提交：{sha}\n目录是否截断：{tree.get("truncated", False)}\n' + '\n'.join(candidates[:300]), 'type': 'repository'})
        for path in paths:
            r = client.get(f'{root}/contents/{quote(path, safe="/")}', params={'ref': sha})
            if r.status_code == 200 and r.json().get('encoding') == 'base64':
                text = base64.b64decode(r.json()['content']).decode('utf-8', errors='replace')
                numbered = '\n'.join(f'{i+1}: {line}' for i, line in enumerate(text.splitlines()))
                sources.append({'title': path, 'url': f'https://github.com/{owner}/{repo}/blob/{sha}/{path}', 'content': numbered[:18000], 'type': 'code'})
        issues = client.get(f'{root}/issues', params={'state': 'all', 'per_page': 8})
        if issues.status_code == 200:
            for issue in issues.json()[:5]:
                sources.append({'title': issue['title'], 'url': issue['html_url'], 'content': (issue.get('body') or '')[:7000], 'type': 'issue'})
    return sources


MAX_STREAM_BYTES = 2_000_000
MAX_STREAM_LINE_BYTES = 262_144
MAX_STREAM_SECONDS = 300


def bounded_stream_lines(response, check=None):
    # Bound decoded bytes too: a compressed or unterminated SSE line must not
    # accumulate without limit. Do not buffer chunks before publishing deltas.
    pending = bytearray()
    total, started = 0, time.monotonic()
    for chunk in response.iter_bytes():
        if check:
            check()
        total += len(chunk)
        if total > MAX_STREAM_BYTES or time.monotonic() - started > MAX_STREAM_SECONDS:
            raise ValueError('模型流式回复超过读取上限，请重试或缩小请求范围')
        pending.extend(chunk)
        while b'\n' in pending:
            end = pending.index(b'\n')
            if end > MAX_STREAM_LINE_BYTES:
                raise ValueError('模型流式回复单行超过读取上限')
            yield bytes(pending[:end]).rstrip(b'\r').decode('utf-8')
            del pending[:end + 1]
        if len(pending) > MAX_STREAM_LINE_BYTES:
            raise ValueError('模型流式回复单行超过读取上限')
    if pending:
        yield pending.decode('utf-8')


def stream_completion(client, url, headers, payload, on_delta, check=None):
    """Read OpenAI-compatible SSE, including fragmented function arguments."""
    message = {'role': 'assistant', 'content': ''}
    calls, tokens, finished = {}, 0, False
    with client.stream('POST', url, headers=headers, json={**payload, 'stream': True, 'stream_options': {'include_usage': True}}) as response:
        if response.status_code >= 400:
            raise ValueError(f'模型服务返回 HTTP {response.status_code}，请检查模型名称、连接地址与密钥权限')
        for line in bounded_stream_lines(response, check):
            if check:
                check()
            if not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                finished = True
                break
            if not data:
                continue
            value = json.loads(data)
            if value.get('error'):
                raise ValueError('模型流式回复失败，请重试')
            tokens = (value.get('usage') or {}).get('total_tokens', tokens)
            for choice in value.get('choices', []):
                if choice.get('index', 0) != 0:
                    continue
                finished = finished or bool(choice.get('finish_reason'))
                delta = choice.get('delta') or {}
                for key in ('content', 'reasoning_content'):
                    if isinstance(delta.get(key), str):
                        message[key] = message.get(key, '') + delta[key]
                        if key == 'content':
                            on_delta(delta[key])
                for part in delta.get('tool_calls') or []:
                    if type(part.get('index')) is not int or not 0 <= part['index'] < 128:
                        raise ValueError('模型返回了无效或过多的工具调用')
                    call = calls.setdefault(part['index'], {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                    if part.get('id'):
                        call['id'] = part['id']
                    for key in ('name', 'arguments'):
                        call['function'][key] += (part.get('function') or {}).get(key) or ''
    if not finished:
        raise ValueError('模型回复连接中断，请重试')
    if calls:
        message['tool_calls'] = [calls[i] for i in sorted(calls)]
    return message, tokens


def model(messages, structured=False, run=None, on_delta=None):
    from .settings import config_for_run, reasoning_payload
    c = config_for_run(run) if run else config()
    if not c['api_key'] or not c['model']:
        raise ValueError('请先在设置中配置模型与 API Key')
    payload = {'model': c['model'], 'messages': messages, 'max_tokens': 3200}
    payload.update(reasoning_payload(run))
    if structured:
        payload['response_format'] = {'type': 'json_object'}
    with httpx.Client(timeout=httpx.Timeout(100, connect=15), trust_env=True) as client:
        if on_delta is not None and not structured:
            message, tokens = stream_completion(client, c['base_url'].rstrip('/') + '/chat/completions', {'Authorization': f"Bearer {c['api_key']}"}, payload, on_delta, getattr(on_delta, 'check', None))
            if not message['content'].strip():
                raise ValueError('模型返回了空文本')
            return message['content'], tokens
        r = client.post(c['base_url'].rstrip('/') + '/chat/completions', headers={'Authorization': f"Bearer {c['api_key']}"}, json=payload)
        if r.status_code >= 400:
            raise ValueError(f'模型服务返回 HTTP {r.status_code}，请检查模型名称、连接地址与密钥权限')
        value = r.json()
    result = value['choices'][0]['message']['content']
    if not isinstance(result, str) or not result.strip():
        raise ValueError('模型返回了空文本')
    if structured:
        result = re.sub(r'^```(?:json)?\s*|\s*```$', '', result.strip())
        result = json.loads(result)
    return result, value.get('usage', {}).get('total_tokens', 0)
