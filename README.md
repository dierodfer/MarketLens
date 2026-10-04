# MarketLens

<img src="icons/icon128.png" alt="MarketLens" width="96">

Extensión de Chrome para Wallapop: filtra los anuncios reservados, compara cada precio con la media de la búsqueda y oculta vendedores que no te interesan.

Basada en [Reserve Sniper](https://github.com/MartinGoDev/Reserve-Sniper-Extension) de MartinGoDev.

## Características

- **Filtro de reservas**: muestra todos los anuncios, solo los disponibles o solo los reservados, también los que se cargan al hacer scroll.
- **Análisis de precios**: precio medio y rango de la búsqueda, y en cada anuncio cuánto está por encima (rojo) o por debajo (verde) de la media.
- **Bloqueo de vendedores**: cada anuncio muestra el ID del vendedor (clic para copiarlo) y un botón para ocultar todos sus anuncios.
- **Ocultar anuncios sueltos** con la × de cada tarjeta.
- **Panel lateral** con métricas en tiempo real; sigue el modo claro/oscuro del sistema.

## Instalación

1. Clona el repositorio:
   ```bash
   git clone https://github.com/dierodfer/MarketLens.git
   ```
2. Abre `chrome://extensions/` y activa el **modo desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto.

## Uso

1. Busca algo en [Wallapop](https://es.wallapop.com).
2. Pulsa la pestaña de MarketLens en el borde derecho de la pantalla para abrir el panel.
3. Elige **Todos**, **Disponibles** o **Reservados**. El interruptor **Filtrado automático** pausa el filtro sin perder la selección.

El punto bajo el logo de la pestaña indica el estado: verde activo, gris en pausa.

## Estructura

```
MarketLens/
├── manifest.json     # Configuración (Manifest V3)
├── content.js        # Panel, filtro, análisis de precios y bloqueo (se inyecta en Wallapop)
├── inject.js         # Lee las respuestas de la API de búsqueda para obtener los vendedores
├── background.js     # Service worker
├── styles.css        # Estilos del panel y de los elementos sobre las tarjetas
├── popup.html/.js    # Popup del icono de la extensión
└── icons/            # Icono de la extensión (SVG fuente y PNG 16/32/48/128)
```

## Detalles técnicos

- Detecta productos con `.item-card_ItemCard--vertical__CNrfk` y, como respaldo, `a[href*="/item/"]`.
- Un anuncio está reservado si contiene `wallapop-badge[badge-type="reserved"]` o una insignia con el texto "Reservado".
- Los vendedores se emparejan con las tarjetas por la URL de la imagen que devuelve la API.
- Las preferencias se guardan con `chrome.storage.local`.

### Depuración

- `Alt+Shift+D`: resumen de disponibles/reservados en la consola.
- `testReservedFilter()` y `showAllProducts()` desde la consola de la página.

## Apoyo

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-yellow.svg)](https://buymeacoffee.com/martingodeg)

## Reportar bugs

Abre un issue en [github.com/dierodfer/MarketLens/issues](https://github.com/dierodfer/MarketLens/issues) con los pasos para reproducirlo.

## Créditos

Proyecto original: **Reserve Sniper** de [MartinGoDev](https://github.com/MartinGoDev) ([LinkedIn](https://www.linkedin.com/in/martin-gonzalez-fernandez-258559142/)).

## Licencia

MIT.
