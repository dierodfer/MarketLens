// Escribe la versión calculada por semantic-release en manifest.json y package.json.
// Uso: node scripts/set-version.mjs 1.2.3
import { execFileSync } from 'node:child_process';
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

// Actualiza package.json y package-lock.json sin crear commit ni etiqueta.
execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], {
  stdio: 'inherit',
});
