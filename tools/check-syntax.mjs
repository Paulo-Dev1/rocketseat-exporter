/**
 * Verificações estáticas do projeto, sem dependências externas:
 * - Sintaxe de todos os arquivos .js em src/ (node --check).
 * - manifest.json válido e todos os arquivos referenciados existentes.
 * - Scripts e folhas de estilo referenciados nos HTML existentes.
 *
 * Uso: node tools/check-syntax.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(join(ROOT, 'src'));

for (const file of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    errors.push(`Sintaxe inválida em ${relative(ROOT, file)}:\n${error.stderr}`);
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const referenced = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
].filter(Boolean);

for (const path of referenced) {
  if (!existsSync(join(ROOT, path))) errors.push(`manifest.json referencia arquivo inexistente: ${path}`);
}

for (const file of files.filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(resolve(dirname(file), ref))) {
      errors.push(`${relative(ROOT, file)} referencia arquivo inexistente: ${ref}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} arquivos verificados; manifest e referências HTML válidos.`);

