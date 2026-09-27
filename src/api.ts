import { tr } from './i18n';
export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Sakuya-Client': 'workspace' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('sakuya-session-expired'));
    const error = await response.json().catch(() => ({ detail: tr("服务暂时不可用") }));
    throw new Error(typeof error.detail === 'string' ? error.detail : tr("请检查填写内容是否符合要求"));
  }
  return response.json();
}

export function download(name: string, content: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
