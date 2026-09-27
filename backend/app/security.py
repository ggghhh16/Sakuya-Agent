"""HTTP limits and credential-safe errors shared by API and worker."""
import asyncio
import os
import re

from starlette.responses import JSONResponse

MAX_BODY = 1_000_000
CSP = (
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; "
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self' https://challenges.cloudflare.com; "
    "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; "
    "object-src 'none'; base-uri 'none'; form-action 'self'"
)


def safe_error(exc):
    from . import settings, integrations
    # Redact before truncation: secrets crossing the limit must not leak prefixes.
    text = str(exc)
    secrets = [v for k, v in os.environ.items()
               if v and re.search(r'(?:KEY|TOKEN|SECRET|PASSWORD)$', k, re.I)]
    config = settings.config()
    secrets.extend(config.get(k, '') for k in ('api_key', 'search_key', 'github_token'))
    secrets.extend(p.get('api_key', '') for p in settings.catalog()[0])
    for name in integrations.PROVIDERS:
        saved = integrations.credentials(name)
        secrets.extend(saved.get(k, '') for k in ('client_secret', 'access_token', 'refresh_token', 'oauth_state', 'verifier'))
    for secret in sorted(set(filter(None, secrets)), key=len, reverse=True):
        text = text.replace(secret, '[REDACTED]')
    text = re.sub(r'(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n<>\"]*', '[LOCAL PATH]', text)
    return text[:1500]


class RequestSafetyMiddleware:
    """Bound actual streamed bytes before parsing, including chunked uploads."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers', []))
                headers.extend([
                    (b'content-security-policy', CSP.encode()),
                    (b'x-frame-options', b'DENY'),
                    (b'x-content-type-options', b'nosniff'),
                    (b'referrer-policy', b'no-referrer'),
                    (b'permissions-policy', b'camera=(), microphone=(), geolocation=()'),
                ])
                if scope['path'].startswith('/api'):
                    headers = [(k, v) for k, v in headers if k.lower() != b'cache-control']
                    headers.append((b'cache-control', b'no-store'))
                message = {**message, 'headers': headers}
            await send(message)

        async def reject(code, detail):
            await JSONResponse({'detail': detail}, status_code=code)(scope, receive, secured_send)

        if scope['method'] in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            lengths = [v for k, v in scope['headers'] if k.lower() == b'content-length']
            if lengths and (len(lengths) != 1 or not lengths[0].isdigit()):
                return await reject(400, '无效请求长度')
            if lengths and (len(lengths[0]) > 10 or int(lengths[0]) > MAX_BODY):
                return await reject(413, '请求超过大小上限')
            body = bytearray()
            try:
                async with asyncio.timeout(15):
                    while True:
                        message = await receive()
                        if message['type'] == 'http.disconnect':
                            return
                        body.extend(message.get('body', b''))
                        if len(body) > MAX_BODY:
                            return await reject(413, '请求超过大小上限')
                        if not message.get('more_body', False):
                            break
            except TimeoutError:
                return await reject(408, '请求接收超时')
            original_receive, delivered = receive, False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
                return await original_receive()

            receive = replay
        await self.app(scope, receive, secured_send)
