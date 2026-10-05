#!/usr/bin/env bash
# Empaqueta la extensión en marketlens-<etiqueta>.zip con los archivos en la raíz,
# lista para "Cargar descomprimida" o para subir a la Chrome Web Store.
# Uso: bash scripts/package.sh v1.2.3
set -euo pipefail

tag="${1:?Falta la etiqueta (p. ej. v1.2.3)}"
out="marketlens-${tag}.zip"

rm -f "$out"
zip -j -X "$out" manifest.json background.js content.js inject.js popup.html popup.js styles.css
zip -X -r "$out" icons -i 'icons/*.png'
unzip -l "$out"
