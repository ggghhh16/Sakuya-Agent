import { listPackage } from '@electron/asar';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root='release-planner/win-unpacked';
const files=listPackage(root+'/resources/app.asar');
const privatePaths=files.filter(p=>/(^|[\\/])(\.env|\.data|provider\.json|workspace\.sqlite|integration_secret)([\\/]|$)/i.test(p));
function walk(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)]);}
const credentialFiles=walk(root+'/resources').filter(p=>/\.(sqlite|db|key)$|[\\/]\.env$/i.test(p)||(/\.pem$/i.test(p)&&!/certifi[\\/]cacert\.pem$/.test(p)));
const web=walk(root+'/resources/web').filter(p=>/\.(js|css|html)$/.test(p));
const webSecretMatches=web.filter(p=>/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-[a-zA-Z0-9]{25,}|AIza[0-9A-Za-z_-]{30,}/.test(readFileSync(p,'utf8')));
const result={asarEntries:files.length,privatePaths,credentialFiles,webSecretMatches,publicCA:'certifi/cacert.pem is an expected public certificate bundle'};
writeFileSync('test-results/planner-package-scan.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
if(privatePaths.length||credentialFiles.length||webSecretMatches.length) process.exitCode=1;
