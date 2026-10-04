// Fixture de Playwright: Chromium con la extensión cargada y Wallapop simulado
const { test: base, chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const SEARCH_URL = 'https://es.wallapop.com/app/search?keywords=bici';
const SEARCH_HTML = fs.readFileSync(path.join(__dirname, '../fixtures/search.html'), 'utf8');

// Vendedor de cada anuncio en la respuesta simulada de la API
const SELLERS = { a1: 'u1', a2: 'u2', a3: 'u3', a4: 'u4' };

function apiResponse() {
  return {
    data: {
      section: {
        payload: {
          items: Object.entries(SELLERS).map(([id, userId]) => ({
            id,
            title: id,
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

  context: async ({ colorScheme }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
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
        return route.fulfill({ contentType: 'text/html', body: SEARCH_HTML });
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
  search: async ({ context }, use) => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => {
      errors.push(`Diálogo nativo inesperado: ${dialog.message()}`);
      await dialog.dismiss();
    });

    await page.goto(SEARCH_URL);
    await expect(page.locator('#ml-tab')).toBeVisible();
    await expect(page.locator('.wallapop-user-id-container')).toHaveCount(4, { timeout: 15_000 });
    await expect(page.locator('#wallapop-average-price-display')).toBeVisible({ timeout: 15_000 });

    await use(page);

    expect(errors, 'errores en la página').toEqual([]);
  }
});

// Helpers
const card = (page, id) => page.locator(`a[href="/item/${id}"]`);
const visibleIds = (page) =>
  page.locator('.item-card_ItemCard--vertical__CNrfk:not(.rs-hidden)').evaluateAll((cards) =>
    cards.map((c) => c.getAttribute('href').replace('/item/', ''))
  );

module.exports = { test, expect, card, visibleIds, SEARCH_URL };
