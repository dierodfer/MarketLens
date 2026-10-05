# MarketLens: guía para Claude

Extensión de Chrome (Manifest V3) para Wallapop. Idioma del proyecto: español.

## Antes de abrir una PR

Pasar siempre, en este orden: `npm run lint`, `npm run test:unit` y `npm run test:e2e` (o `npm test`, que ejecuta los tres).

## Gestión de versiones

La versión se calcula automáticamente con [semantic-release](https://semantic-release.gitbook.io) a partir de los mensajes de commit. **Nunca se edita a mano la `version` de `manifest.json` ni la de `package.json`**: la escribe el proceso de release.

### Commits convencionales

Todos los commits (y el título de la PR si se hace squash) siguen el formato `tipo(ámbito opcional): descripción`.

| Commit | Efecto en la versión |
| --- | --- |
| `fix:` | patch (1.0.0 → 1.0.1) |
| `feat:` | minor (1.0.0 → 1.1.0) |
| `BREAKING CHANGE:` en el pie, o `tipo!:` | major (1.0.0 → 2.0.0) |
| `chore:`, `docs:`, `ci:`, `test:`, `refactor:`, `style:` | no generan release |

Elegir el tipo según el efecto para el usuario de la extensión: un cambio visible o una función nueva es `feat`, una corrección es `fix`, y todo lo que no cambia el comportamiento (CI, docs, tests, dependencias de desarrollo) es `chore`/`docs`/`ci`/`test`. Si un cambio rompe datos guardados o ajustes de los usuarios, marcarlo como `BREAKING CHANGE`.

### Cómo se produce una release

1. Los commits convencionales llegan a `master` mediante PR.
2. Al fusionar, [`release.yml`](.github/workflows/release.yml) pasa lint y tests y ejecuta semantic-release (configuración en [`.releaserc.json`](.releaserc.json)).
3. Si hay commits que justifiquen release, `scripts/set-version.mjs` escribe la versión en `manifest.json` y `package.json`, `scripts/package.sh` genera `marketlens-vX.Y.Z.zip`, se sube el commit `chore(release): X.Y.Z [skip ci]`, se crea la etiqueta `vX.Y.Z` y la release de GitHub con el `.zip` adjunto.

La versión base es `0.0.0` (etiqueta `v0.0.0`, creada por el workflow la primera vez), de modo que la primera release es la `0.0.1` con un `fix:` (un `feat:` daría `0.1.0`). No crear etiquetas ni releases a mano. Si `master` tiene protección de rama, el workflow necesita permiso para subir el commit de versión. Los tests no deben fijar un número de versión: leerlo de `manifest.json`.

## Reglas de trabajo

- Mostrar la propuesta antes de cambiar nada importante.
- Preguntar antes de fusionar una PR o publicar una release.
