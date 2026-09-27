import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

const english = JSON.parse(readFileSync('src/locales/en.json', 'utf8'));
const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
for (const file of readdirSync('src/locales').filter(name => name.endsWith('.json') && name !== 'en.json')) {
  const catalog = JSON.parse(readFileSync(`src/locales/${file}`, 'utf8'));
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(english).sort(), `Incomplete locale: ${file}`);
  for (const [key, value] of Object.entries(catalog)) {
    assert(value.trim(), `Empty translation: ${file}: ${key}`);
    assert.deepEqual(placeholders(value), placeholders(key), `Placeholder mismatch: ${file}: ${key}`);
  }
}
for (const [key, value] of Object.entries(english)) {
  assert(value.trim(), `Empty translation: ${key}`);
  assert.deepEqual(placeholders(value), placeholders(key), `Placeholder mismatch: ${key}`);
}
let checked = 0;
const missing = [];
for (const file of readdirSync('src').filter(name => /\.tsx?$/.test(name) && name !== 'language-switch.tsx')) {
  const ast = ts.createSourceFile(file, readFileSync(`src/${file}`, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isStringLiteral(node) && /[\u4e00-\u9fff]/.test(node.text)) {
      checked++;
      if (!(node.text in english)) missing.push(`${file}: ${node.text}`);
    }
    if (ts.isJsxText(node) && /[\u4e00-\u9fff]/.test(node.text)) missing.push(`${file}: unmarked JSX text`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
assert.deepEqual(missing, [], 'Missing interface translations');
console.log(`Locale coverage passed: ${checked} source strings, ${Object.keys(english).length} translations.`);
