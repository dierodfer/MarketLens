// Escribe la versión calculada por semantic-release en manifest.json y package.json.
// Uso: node scripts/set-version.mjs 1.2.3
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`Versión no válida: ${version}`);
  process.exit(1);
}

// Sustitución textual para no reformatear el manifest.
const manifest = readFileSync('manifest.json', 'utf8');
const updated = manifest.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
if (updated === manifest && !manifest.includes(`"version": "${version}"`)) {
  console.error('No se encontró "version" en manifest.json');
  process.exit(1);
}
writeFileSync('manifest.json', updated);

// package.json y package-lock.json: se reescriben como JSON (mismo formato, 2 espacios).
for (const file of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
