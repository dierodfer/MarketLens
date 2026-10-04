// Validación estática del manifest y de los ficheros que referencia
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

test('usa Manifest V3 y se llama MarketLens', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'MarketLens');
  assert.equal(manifest.action.default_title, 'MarketLens');
});

test('la versión del manifest coincide con package.json', () => {
  assert.equal(manifest.version, pkg.version);
});

test('existen todos los ficheros referenciados', () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((script) => [...(script.js || []), ...(script.css || [])])
  ];

  for (const file of files) {
    assert.ok(existsSync(file), `falta ${file}`);
  }
});

test('los iconos son PNG reales del tamaño declarado', () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = readFileSync(file);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} no es un PNG`);
    assert.equal(png.readUInt32BE(16), Number(size), `${file}: ancho incorrecto`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file}: alto incorrecto`);
  }
});

test('el content script solo se inyecta en Wallapop', () => {
  for (const script of manifest.content_scripts) {
    for (const match of script.matches) {
      assert.match(match, /^\*:\/\/(es|www)\.wallapop\.com\/\*$/);
    }
  }
});

test('inject.js es accesible desde la página', () => {
  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  assert.ok(resources.includes('inject.js'));
});
