// Fixture de Playwright: Chromium con la extensión cargada y Wallapop simulado
const { test: base, chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const fixture = (name) => fs.readFileSync(path.join(__dirname, `../fixtures/${name}`), 'utf8');

// Wallapop usa dos formatos de tarjeta: el de la búsqueda (<article>) y el del perfil de un vendedor (<a>)
const LAYOUTS = {
  search: { url: 'https://es.wallapop.com/search?keywords=bici', html: fixture('search.html') },
  profile: { url: 'https://es.wallapop.com/user/vendedor-123', html: fixture('profile.html') }
};
const pageFor = (url) => (new URL(url).pathname.startsWith('/user/') ? LAYOUTS.profile : LAYOUTS.search);

// Vendedor de cada anuncio en la respuesta simulada de la API
const SELLERS = { a1: 'u1', a2: 'u2', a3: 'u3', a4: 'u4' };

// Descripción de cada anuncio en la respuesta simulada de la API (la tarjeta no la muestra)
const DESCRIPTIONS = {
  a1: 'Bicicleta de montaña en buen estado, talla M.',
  a2: 'Carretera ligera. Revisada en taller.',
  a3: 'Urbana con CESTA delantera y portaequipajes.',
  a4: 'Eléctrica con batería nueva, autonomía de 60 km.'
};

function apiResponse() {
  return {
    data: {
      section: {
        payload: {
          items: Object.entries(SELLERS).map(([id, userId]) => ({
            id,
            web_slug: id,
            title: id,
            description: DESCRIPTIONS[id],
            user_id: userId,
            images: [{ urls: { medium: `https://cdn.wallapop.com/images/${id}.svg` } }]
          }))
        }
      }
    }
  };
}

const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#d9dde3"/></svg>';

const test = base.extend({
  colorScheme: ['light', { option: true }],
  layout: ['search', { option: true }],

  searchUrl: async ({ layout }, use) => {
    await use(LAYOUTS[layout].url);
  },

  context: async ({ colorScheme }, use) => {
    // CHROMIUM_PATH permite usar un Chromium ya instalado (no Chrome: no carga extensiones)
    const browser = process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : { channel: 'chromium' };

    const context = await chromium.launchPersistentContext('', {
      ...browser,
      colorScheme,
      viewport: { width: 1280, height: 720 },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`
      ]
    });

    // Nada sale a internet: Wallapop, su API y sus imágenes se sirven en local
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('https://es.wallapop.com/')) {
        return route.fulfill({ contentType: 'text/html', body: pageFor(url).html });
      }
      if (url.includes('api.wallapop.com')) {
        return route.fulfill({
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(apiResponse())
        });
      }
      if (url.includes('cdn.wallapop.com')) {
        return route.fulfill({ contentType: 'image/svg+xml', body: PLACEHOLDER_SVG });
      }
      if (url.startsWith('chrome-extension://') || url.startsWith('data:')) {
        return route.continue();
      }
      return route.abort();
    });

    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },

  // Página de búsqueda con la extensión ya inicializada y los vendedores emparejados
  search: async ({ context, searchUrl }, use) => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => {
      errors.push(`Diálogo nativo inesperado: ${dialog.message()}`);
      await dialog.dismiss();
    });

    await page.goto(searchUrl);
    await expect(page.locator('#ml-tab')).toBeVisible();
    await expect(page.locator('.wallapop-user-id-container')).toHaveCount(4, { timeout: 15_000 });
    await expect(page.locator('#wallapop-average-price-display')).toBeVisible({ timeout: 15_000 });

    await use(page);

    expect(errors, 'errores en la página').toEqual([]);
  }
});

// Helpers válidos para los dos formatos de tarjeta
const CARDS = 'a.item-card_ItemCard--vertical__CNrfk, article[class*="ItemCard"]';
const card = (page, id) =>
  page.locator(`a.item-card_ItemCard--vertical__CNrfk[href$="/item/${id}"], article[class*="ItemCard"]:has(a[href$="/item/${id}"])`);
const visibleIds = (page) =>
  page.locator(CARDS).evaluateAll((cards) =>
    cards
      .filter((c) => !c.classList.contains('rs-hidden'))
      .map((c) => (c.matches('a') ? c : c.querySelector('a[href*="/item/"]')).getAttribute('href').split('/item/')[1])
  );

module.exports = { test, expect, card, visibleIds };
