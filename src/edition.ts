declare const __SAKUYA_EDITION__: 'dev' | 'client';
export const isClient = __SAKUYA_EDITION__ === 'client';
export const productName = isClient ? 'Sakuya Client' : 'Sakuya';
export function availableRoute(route: string) {
  return isClient && /^(?:tickets?|diagnosis)(?:\/|$)/.test(route) ? 'work' : route;
}
