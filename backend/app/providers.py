import base64
import ipaddress
import json
import os
import re
import socket
from urllib.parse import urlparse, quote
from urllib.request import getproxies, proxy_bypass
import httpx
from bs4 import BeautifulSoup
from .settings import config, DEFAULT_HOSTS


def validate_url(url):
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
    if not proxy:
        for info in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM):
            if not ipaddress.ip_address(info[4][0]).is_global:
                raise ValueError('不允许访问本机或私有网络资料地址')
    return url


def fetch_source(url):
    with httpx.Client(timeout=20, follow_redirects=False, trust_env=True) as client:
        for _ in range(4):
            validate_url(url)
            with client.stream('GET', url, headers={'User-Agent': 'SakuyaResearch/0.1'}) as response:
                if response.is_redirect:
                    from urllib.parse import urljoin
                    url = urljoin(url, response.headers.get('location', ''))
                    continue
                response.raise_for_status()
                body = bytearray()
                for chunk in response.iter_bytes():
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


def model(messages, structured=False, run=None):
    from .settings import config_for_run, reasoning_payload
    c = config_for_run(run) if run else config()
    if not c['api_key'] or not c['model']:
        raise ValueError('请先在设置中配置模型与 API Key')
    payload = {'model': c['model'], 'messages': messages, 'max_tokens': 3200}
    payload.update(reasoning_payload(run))
    if structured:
        payload['response_format'] = {'type': 'json_object'}
    with httpx.Client(timeout=httpx.Timeout(100, connect=15), trust_env=True) as client:
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
