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

Flujo previsto:

1. Los commits convencionales llegan a `master` mediante PR.
2. semantic-release analiza los commits desde la última etiqueta, decide la versión siguiente y, si hay cambios que lo justifiquen, actualiza `manifest.json` y `package.json`, crea la etiqueta `vX.Y.Z` y la release de GitHub con las notas generadas.
3. El workflow [`release.yml`](.github/workflows/release.yml) pasa lint y tests, empaqueta la extensión en `marketlens-vX.Y.Z.zip` y lo adjunta a la release.

### Estado actual

El repositorio **todavía no está adaptado** a este flujo: `release.yml` se dispara al subir una etiqueta `vX.Y.Z` manual y exige que coincida con la versión del manifest, y el README describe subir la versión a mano. Hasta que se configure semantic-release (dependencia, configuración y workflow que ejecute `semantic-release` y haga el commit de versión), conviene no crear etiquetas ni subir versiones manualmente. Al adaptarlo, mantener el empaquetado del `.zip` y actualizar la sección «Releases» del README.

## Reglas de trabajo

- Mostrar la propuesta antes de cambiar nada importante.
- Preguntar antes de fusionar una PR o publicar una release.
