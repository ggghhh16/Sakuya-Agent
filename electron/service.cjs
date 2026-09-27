const http = require('node:http');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, openSync, closeSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

function probe(port) {
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, response => {
      let body = '';
      response.on('data', chunk => { if (body.length < 10000) body += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ other: true }); } });
      response.on('error', () => resolve({ other: true }));
    });
    request.on('timeout', () => { request.destroy(); resolve({ other: true }); });
    request.on('error', error => resolve(error.code === 'ECONNREFUSED' ? null : { other: true }));
  });
}

class LocalService {
  constructor({ port, command, args = [], dataDir, webDir, envFile }) {
    Object.assign(this, { port, command, args, dataDir, webDir, envFile });
    this.child = null;
  }
  async start() {
    const existing = await probe(this.port);
    if (existing) {
      // A public health response proves neither ownership nor authenticity.
      // Never load a login page from a service this launcher did not start.
      throw new Error(`本机 ${this.port} 端口已被其他服务或未就绪的旧版本占用。请退出该服务后重新打开 Sakuya。`);
    }
    if (!existsSync(this.command)) throw new Error('缺少内置服务文件，请使用完整的 Sakuya 应用目录。');
    if (!existsSync(join(this.webDir, 'index.html'))) throw new Error('缺少网页资源，请重新构建应用。');
    mkdirSync(this.dataDir, { recursive: true });
    const instance = randomUUID();
    const logPath = join(this.dataDir, 'service.log');
    const fd = openSync(logPath, 'a');
    const environment = { ...process.env, PYTHONUTF8: '1', SAKUYA_PORT: String(this.port), SAKUYA_INSTANCE: instance,
      SAKUYA_DATA_DIR: this.dataDir, SAKUYA_WEB_DIR: this.webDir, SAKUYA_ENV_FILE: this.envFile || join(this.dataDir, '.env') };
    delete environment.PYTHONHOME;
    delete environment.PYTHONPATH;
    let failure;
    try {
      this.child = spawn(this.command, [...this.args, '--port', String(this.port), '--managed'], {
        cwd: this.dataDir, env: environment, windowsHide: true, stdio: ['pipe', fd, fd],
      });
      this.child.once('error', error => { failure = error; });
      this.child.once('exit', code => { failure ||= new Error(`内置服务已退出（${code}）。`); });
    } finally { closeSync(fd); }
    for (let attempt = 0; attempt < 120; attempt++) {
      if (failure) break;
      const status = await probe(this.port);
      if (status?.service === 'sakuya-agent' && status.instance === instance && status.worker_online) return;
      if (status && status.instance !== instance) { failure = new Error('启动期间端口被其他进程占用。'); break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await this.stop();
    throw new Error(`${failure?.message || '内置服务启动超时。'} 可检查日志：${logPath}`);
  }
  async stop() {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode) return;
    await new Promise(resolve => {
      const timeout = setTimeout(() => { child.kill(); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); });
      // The owned service exits on EOF. Never kill a pre-existing service.
      child.stdin.end();
    });
  }
}
module.exports = { LocalService, probe };
