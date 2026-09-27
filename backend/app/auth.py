"""Email accounts, one-use verification codes and server-side sessions."""
import hashlib
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import time
from typing import Literal
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from . import db

router = APIRouter(prefix='/api/auth')
COOKIE = 'sakuya_session'


def init():
    with db.connect(shared=True) as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user','admin')), created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS email_codes (
          email TEXT PRIMARY KEY, digest TEXT NOT NULL, salt TEXT NOT NULL,
          expires REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS auth_limits (
          key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS browser_checks (
          id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE NOT NULL, action TEXT NOT NULL,
          expires REAL NOT NULL, verified INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS usernames (
          user_id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized TEXT UNIQUE NOT NULL);
        ''')
        for row in con.execute('SELECT id,email FROM users').fetchall():
            ensure_username(con, row)


def normalize_username(value):
    value = value.strip()
    if not re.fullmatch(r'[\w-]{3,32}', value, re.UNICODE):
        raise ValueError('用户名须为 3–32 位字母、数字、下划线或短横线')
    return value


def ensure_username(con, row):
    existing = con.execute('SELECT name FROM usernames WHERE user_id=?', (row['id'],)).fetchone()
    if existing:
        return existing['name']
    base = re.sub(r'[^\w-]', '_', row['email'].split('@')[0])[:24]
    if len(base) < 3:
        base = 'user_' + base
    name = base
    suffix = 1
    while con.execute('SELECT 1 FROM usernames WHERE normalized=?', (name.casefold(),)).fetchone():
        suffix += 1
        name = f'{base}_{suffix}'
    con.execute('INSERT INTO usernames VALUES (?,?,?)', (row['id'], name, name.casefold()))
    return name


def display_name(identifier):
    with db.connect(shared=True) as con:
        row = con.execute('SELECT id,email FROM users WHERE id=? OR email=?', (identifier, identifier)).fetchone()
        if row:
            return ensure_username(con, row)
    return '已注销用户' if '@' in identifier else identifier


def normalize_email(email):
    value = email.strip().lower()
    if len(value) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise ValueError('请填写有效邮箱地址')
    return value


def validate_password(password):
    if not 8 <= len(password) <= 128 or not re.search('[a-z]', password) or not re.search('[A-Z]', password):
        raise ValueError('密码长度须为 8–128 位，并至少包含一个大写字母和一个小写字母')


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f'{salt}:{digest}'


def public_user(row):
    with db.connect(shared=True) as con:
        name = ensure_username(con, row)
    return {k: row[k] for k in ('id', 'email', 'role')} | {'username': name}


def current_user(request):
    token = request.cookies.get(COOKIE, '')
    if not token:
        return None
    with db.connect(shared=True) as con:
        row = con.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
                          (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    return public_user(row) if row else None


def limit(key, maximum, window):
    now = time.time()
    with db.connect(shared=True) as con:
        con.execute('BEGIN IMMEDIATE')
        con.execute('DELETE FROM auth_limits WHERE expires<?', (now,))
        row = con.execute('SELECT count FROM auth_limits WHERE key=?', (key,)).fetchone()
        if row and row['count'] >= maximum:
            raise HTTPException(429, '操作过于频繁，请稍后再试')
        con.execute('INSERT INTO auth_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, now + window))


def verify_human(token, action):
    if token.startswith('desktop:'):
        with db.connect(shared=True) as con:
            con.execute('BEGIN IMMEDIATE')
            row = con.execute('DELETE FROM browser_checks WHERE secret_hash=? AND action=? AND verified=1 AND expires>? RETURNING id',
                              (hashlib.sha256(token[8:].encode()).hexdigest(), action, time.time())).fetchone()
        if not row:
            raise HTTPException(400, '浏览器验证未完成、已使用或已过期，请重新验证')
        return
    verify_turnstile(token, action)


def verify_turnstile(token, action):
    secret = os.getenv('TURNSTILE_SECRET_KEY', '')
    if not secret:
        raise HTTPException(503, '尚未配置人机验证服务，请联系管理员')
    try:
        response = httpx.post('https://challenges.cloudflare.com/turnstile/v0/siteverify',
                              data={'secret': secret, 'response': token}, timeout=15)
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, '人机验证服务暂时不可用')
    allowed_hosts = {x.strip() for x in os.getenv('TURNSTILE_HOSTNAMES', 'localhost,127.0.0.1').split(',')}
    if not result.get('success') or result.get('action') != action or result.get('hostname') not in allowed_hosts:
        raise HTTPException(400, '人机验证失败或已过期，请重新验证')


def send_email(email, code):
    host, sender = os.getenv('SMTP_HOST'), os.getenv('SMTP_FROM')
    if not host or not sender:
        raise HTTPException(503, '尚未配置邮件服务，请联系管理员')
    message = EmailMessage()
    message['Subject'] = 'Sakuya Agent 注册验证码'
    message['From'], message['To'] = sender, email
    message.set_content(f'你的注册验证码是：{code}\n10 分钟内有效。请勿向他人提供此验证码。\n如果不是你发起的注册，请忽略本邮件。')
    try:
        secure = os.getenv('SMTP_SECURITY', 'starttls')
        if secure not in {'ssl', 'starttls'}:
            raise ValueError('SMTP_SECURITY must be ssl or starttls')
        cls = smtplib.SMTP_SSL if secure == 'ssl' else smtplib.SMTP
        kwargs = {'context': ssl.create_default_context()} if secure == 'ssl' else {}
        with cls(host, int(os.getenv('SMTP_PORT', '465' if secure == 'ssl' else '587')), timeout=20, **kwargs) as smtp:
            if secure == 'starttls':
                smtp.starttls(context=ssl.create_default_context())
            if os.getenv('SMTP_USERNAME'):
                smtp.login(os.environ['SMTP_USERNAME'], os.getenv('SMTP_PASSWORD', ''))
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError):
        raise HTTPException(503, '验证码发送失败，请检查邮件服务配置后重试')


def issue_session(user_id, response, remember=False):
    token = secrets.token_urlsafe(32)
    lifetime = (30 if remember else 1) * 86400
    with db.connect(shared=True) as con:
        con.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        con.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + lifetime))
    response.set_cookie(COOKIE, token, max_age=lifetime if remember else None, httponly=True, samesite='lax',
                        secure=os.getenv('SAKUYA_COOKIE_SECURE') == '1', path='/')
    return token


class EmailCodeIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(max_length=254)
    human_token: str = Field(min_length=1, max_length=2048)


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=3, max_length=32)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)
    code: str = Field(pattern=r'^\d{6}$')


class LoginIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(default='', max_length=254)
    identifier: str = Field(default='', max_length=254)
    human_token: str = Field(min_length=1, max_length=2048)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class BrowserCheckIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['login', 'register']


class BrowserPollIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    secret: str = Field(min_length=43, max_length=43)


class BrowserCompleteIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    human_token: str = Field(min_length=1, max_length=2048)


def browser_check(check_id):
    with db.connect(shared=True) as con:
        row = con.execute('SELECT * FROM browser_checks WHERE id=? AND expires>?', (check_id, time.time())).fetchone()
    if not row:
        raise HTTPException(410, '本次验证已过期或已使用，请返回桌面重新发起')
    return row


@router.post('/browser-check')
def create_browser_check(data: BrowserCheckIn, request: Request):
    limit('browser-check:' + request.client.host, 30, 900)
    check_id, secret = secrets.token_urlsafe(24), secrets.token_urlsafe(32)
    expires = time.time() + 300
    with db.connect(shared=True) as con:
        con.execute('DELETE FROM browser_checks WHERE expires<?', (time.time(),))
        con.execute('INSERT INTO browser_checks VALUES (?,?,?,?,0)',
                    (check_id, hashlib.sha256(secret.encode()).hexdigest(), data.action, expires))
    # Only the initiating client receives this secret; the browser URL contains only the public id.
    return {'id': check_id, 'secret': secret, 'expires': expires}


@router.get('/browser-check/{check_id}')
def browser_check_info(check_id: str):
    row = browser_check(check_id)
    return {'action': row['action'], 'verified': bool(row['verified'])}


@router.post('/browser-check/{check_id}/complete')
def complete_browser_check(check_id: str, data: BrowserCompleteIn, request: Request):
    limit('browser-complete:' + request.client.host, 60, 900)
    row = browser_check(check_id)
    if row['verified']:
        raise HTTPException(409, '本次验证已完成，请返回桌面继续')
    # Always validate with Cloudflare; an existing desktop proof must never create another proof.
    verify_turnstile(data.human_token, row['action'])
    with db.connect(shared=True) as con:
        updated = con.execute('UPDATE browser_checks SET verified=1 WHERE id=? AND verified=0 AND expires>?',
                              (check_id, time.time())).rowcount
    if not updated:
        raise HTTPException(410, '本次验证已过期或已使用，请返回桌面重新发起')
    return {'ok': True}


@router.post('/browser-check/{check_id}/poll')
def poll_browser_check(check_id: str, data: BrowserPollIn):
    row = browser_check(check_id)
    if not hmac.compare_digest(row['secret_hash'], hashlib.sha256(data.secret.encode()).hexdigest()):
        raise HTTPException(403, '无法读取本次验证')
    return {'verified': bool(row['verified']), 'expires': row['expires']}


@router.get('/config')
def auth_config():
    return {'site_key': os.getenv('TURNSTILE_SITE_KEY', ''),
            'registration_ready': all(os.getenv(k) for k in ('TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'SMTP_HOST', 'SMTP_FROM'))}


@router.get('/me')
def me(request: Request):
    return {'user': current_user(request)}


@router.post('/email-code')
def email_code(data: EmailCodeIn, request: Request):
    email = normalize_email(data.email)
    limit('send-ip:' + request.client.host, 10, 3600)
    verify_human(data.human_token, 'register')
    limit('send-email:' + email, 1, 90)
    code, salt = f'{secrets.randbelow(1_000_000):06}', secrets.token_hex(16)
    digest = hashlib.sha256((salt + code).encode()).hexdigest()
    # Reserve before SMTP; an old code cannot become valid again on delivery failure.
    with db.connect(shared=True) as con:
        con.execute('INSERT OR REPLACE INTO email_codes VALUES (?,?,?,?,0)', (email, digest, salt, time.time() + 600))
    try:
        send_email(email, code)
    except Exception:
        with db.connect(shared=True) as con:
            con.execute('DELETE FROM email_codes WHERE email=? AND digest=?', (email, digest))
        raise
    return {'ok': True, 'retry_after': 90}


@router.post('/register', status_code=201)
def register(data: RegisterIn, request: Request):
    email = normalize_email(data.email)
    username = normalize_username(data.username)
    validate_password(data.password)
    limit('register-ip:' + request.client.host, 30, 3600)
    encoded = password_hash(data.password)
    error = None
    with db.connect(shared=True) as con:
        con.execute('BEGIN IMMEDIATE')
        if con.execute('SELECT 1 FROM usernames WHERE normalized=?', (username.casefold(),)).fetchone():
            raise HTTPException(409, '该用户名已被使用')
        row = con.execute('SELECT * FROM email_codes WHERE email=?', (email,)).fetchone()
        if not row or row['expires'] < time.time() or row['attempts'] >= 5:
            error = '验证码已失效，请重新获取'
        elif not hmac.compare_digest(row['digest'], hashlib.sha256((row['salt'] + data.code).encode()).hexdigest()):
            con.execute('UPDATE email_codes SET attempts=attempts+1 WHERE email=?', (email,))
            error = '邮箱验证码不正确'
        else:
            try:
                user_id = db.uid('user')
                con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (user_id, email, encoded, 'user', db.now()))
                con.execute('INSERT INTO usernames VALUES (?,?,?)', (user_id, username, username.casefold()))
            except sqlite3.IntegrityError:
                error = '该邮箱已注册，请登录'
            con.execute('DELETE FROM email_codes WHERE email=?', (email,))
    if error:
        raise HTTPException(400, error)
    return {'ok': True}


@router.post('/login')
def login(data: LoginIn, request: Request, response: Response):
    identifier = (data.identifier or data.email).strip().casefold()
    if not identifier:
        raise HTTPException(400, '请输入用户名或邮箱')
    limit('login-ip:' + request.client.host, 30, 900)
    limit('login-email:' + identifier, 10, 900)
    verify_human(data.human_token, 'login')
    with db.connect(shared=True) as con:
        row = con.execute('SELECT u.* FROM users u LEFT JOIN usernames n ON n.user_id=u.id WHERE u.email=? OR n.normalized=?', (identifier, identifier)).fetchone()
    expected = row['password'] if row else password_hash('InvalidPassword')
    candidate = password_hash(data.password, expected.split(':')[0])
    if not row or not hmac.compare_digest(candidate, expected):
        raise HTTPException(401, '用户名、邮箱或密码不正确')
    old = request.cookies.get(COOKIE, '')
    with db.connect(shared=True) as con:
        con.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(old.encode()).hexdigest(),))
    issue_session(row['id'], response, data.remember)
    return {'user': public_user(row)}


@router.post('/logout')
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, '')
    with db.connect(shared=True) as con:
        con.execute('DELETE FROM sessions WHERE token=?', (hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie(COOKIE, path='/')
    return {'ok': True}


def configure_admin(email):
    from getpass import getpass
    from . import settings  # load local environment configuration
    db.init()
    init()
    address = normalize_email(email)
    with db.connect(shared=True) as con:
        exists = con.execute('SELECT id FROM users WHERE email=?', (address,)).fetchone()
        if exists:
            con.execute("UPDATE users SET role='admin' WHERE email=?", (address,))
        else:
            password = getpass('管理员密码（至少 8 位，含大小写字母）：')
            validate_password(password)
            if password != getpass('再次输入密码：'):
                raise SystemExit('两次密码不一致')
            con.execute('INSERT INTO users VALUES (?,?,?,?,?)', (db.uid('user'), address, password_hash(password), 'admin', db.now()))
    init()
    print('管理员账号已配置。用户名：' + display_name(address))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='在本机创建管理员或提升已有账号')
    parser.add_argument('email')
    configure_admin(parser.parse_args().email)
