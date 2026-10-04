// Comprueba que todos los scripts de la extensión son JavaScript válido
import { execFileSync } from 'node:child_process';

const files = ['background.js', 'content.js', 'inject.js', 'popup.js'];
let failed = false;

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`✓ ${file}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${file}\n${error.stderr}`);
  }
}

process.exit(failed ? 1 : 0);
