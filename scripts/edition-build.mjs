import { readFileSync } from 'node:fs';

export function editionConfig(edition) {
  if (!['dev', 'client'].includes(edition)) throw new Error('Edition must be dev or client');
  const original = JSON.parse(readFileSync('package.json', 'utf8')).build;
  const client = edition === 'client';
  const frontend = client ? 'dist-client' : 'dist';
  return {
    ...original,
    appId: client ? 'dev.sakuya.client' : original.appId,
    productName: client ? 'Sakuya Client' : original.productName,
    extraMetadata: { sakuyaEdition: edition },
    directories: { output: `release-${edition}` },
    files: [{ from: frontend, to: 'dist' }, 'electron/**/*', 'package.json'],
    extraResources: [
      { from: `.build/backend-${edition}/sakuya-service`, to: 'backend', filter: ['**/*'] },
      { from: frontend, to: 'web', filter: ['**/*'] },
    ],
    win: { ...original.win, artifactName: `Sakuya-${client ? 'Client' : 'Agent-Dev'}-Setup-` + '${version}-x64.exe' },
    nsis: { ...original.nsis, ...(client ? { shortcutName: 'Sakuya Client' } : {}) },
  };
}
