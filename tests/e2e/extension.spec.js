const { test, expect, card, visibleIds, SEARCH_URL } = require('./fixtures');

test.describe('Panel lateral', () => {
  test('se inyecta una sola vez y se abre desde la pestaña', async ({ search: page }) => {
    await expect(page.locator('#ml-sidebar')).toHaveCount(1);
    await expect(page.locator('#ml-sidebar')).not.toHaveClass(/ml-open/);

    await page.locator('#ml-tab').click();
    await expect(page.locator('#ml-sidebar')).toHaveClass(/ml-open/);
    await expect(page.locator('#ml-tab')).toBeHidden();

    await page.locator('#toggle-sidebar').click();
    await expect(page.locator('#ml-sidebar')).not.toHaveClass(/ml-open/);
    await expect(page.locator('#ml-tab')).toBeVisible();
  });

  test('muestra las métricas de la búsqueda', async ({ search: page }) => {
    await page.locator('#ml-tab').click();
    await expect(page.locator('#sidebar-results-count')).toHaveText('4');
    await expect(page.locator('#ml-visible-count')).toHaveText('4');
    await expect(page.locator('#ml-reserved-count')).toHaveText('2');
    await expect(page.locator('#sidebar-status')).toHaveText('Wallapop · 4 de 4 visibles');
  });

  test('no se duplica al navegar atrás y adelante', async ({ search: page }) => {
    await page.evaluate(() => {
      history.pushState({}, '', '/otra');
      history.back();
    });
    await page.waitForTimeout(1500);

    await expect(page.locator('#ml-sidebar')).toHaveCount(1);
    await expect(page.locator('#ml-tab')).toHaveCount(1);
  });
});

test.describe('Filtro de reservas', () => {
  test('filtra disponibles y reservados', async ({ search: page }) => {
    await page.locator('#ml-tab').click();

    await page.getByRole('button', { name: 'Reservados', exact: true }).click();
    expect(await visibleIds(page)).toEqual(['a2', 'a4']);
    await expect(page.getByRole('button', { name: 'Reservados', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
    expect(await visibleIds(page)).toEqual(['a1', 'a3']);

    await page.getByRole('button', { name: 'Todos', exact: true }).click();
    expect(await visibleIds(page)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  test('el interruptor pausa el filtro y lo recuerda al recargar', async ({ search: page }) => {
    await page.locator('#ml-tab').click();
    await page.getByRole('button', { name: 'Reservados', exact: true }).click();

    await page.locator('.ml-switch').click();
    await expect(page.locator('#extension-toggle')).not.toBeChecked();
    expect(await visibleIds(page)).toEqual(['a1', 'a2', 'a3', 'a4']);
    await expect(page.locator('#ml-tab-dot')).not.toHaveClass(/ml-on/);

    // Elegir un filtro vuelve a activar el filtrado
    await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
    await expect(page.locator('#extension-toggle')).toBeChecked();
    expect(await visibleIds(page)).toEqual(['a1', 'a3']);

    await page.reload();
    await expect.poll(() => visibleIds(page), { timeout: 10_000 }).toEqual(['a1', 'a3']);
  });
});

test.describe('Análisis de precios', () => {
  test('calcula la media, el rango y la diferencia de cada anuncio', async ({ search: page }) => {
    await expect(page.locator('#wallapop-average-price-display')).toContainText('225 €');
    await expect(page.locator('#wallapop-average-price-display')).toContainText('4 anuncios');

    await expect(card(page, 'a1').locator('.wallapop-price-indicator')).toHaveText('+75 €');
    await expect(card(page, 'a1').locator('.wallapop-price-indicator')).toHaveClass(/ml-above/);
    await expect(card(page, 'a2').locator('.wallapop-price-indicator')).toHaveText('−125 €');
    await expect(card(page, 'a2').locator('.wallapop-price-indicator')).toHaveClass(/ml-below/);

    await page.locator('#ml-tab').click();
    await expect(page.locator('#ml-avg-price')).toHaveText('225 €');
    await expect(page.locator('#ml-price-range')).toHaveText('100 € – 400 €');
  });

  test('recalcula todos los indicadores al cargar más anuncios', async ({ search: page }) => {
    await page.evaluate(() => {
      window.addCard({ id: 'a5', title: 'Bici gravel', price: '1.100 €' });
      window.dispatchEvent(new Event('scroll'));
    });

    await expect(page.locator('#wallapop-average-price-display')).toContainText('400 €', { timeout: 10_000 });
    // Los anuncios que ya estaban se comparan con la media nueva
    await expect(card(page, 'a1').locator('.wallapop-price-indicator')).toHaveText('−100 €');
    await expect(card(page, 'a4').locator('.wallapop-price-indicator')).toHaveText('= media');
    await expect(card(page, 'a5').locator('.wallapop-price-indicator')).toHaveText('+700 €');
  });
});

test.describe('Bloqueo de vendedores', () => {
  test('muestra el vendedor de cada anuncio según la API', async ({ search: page }) => {
    for (const [id, seller] of [['a1', 'u1'], ['a2', 'u2'], ['a3', 'u3'], ['a4', 'u4']]) {
      await expect(card(page, id).locator('.wallapop-user-id-display')).toHaveText(seller);
    }
  });

  test('cancelar el diálogo no oculta nada', async ({ search: page }) => {
    await card(page, 'a1').getByRole('button', { name: 'Bloquear' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('¿Bloquear a u1?');
    await expect(dialog).toContainText('Se ocultará su anuncio en esta página.');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(card(page, 'a1')).toHaveCount(1);
  });

  test('bloquear oculta sus anuncios y recalcula la media', async ({ search: page }) => {
    await card(page, 'a1').getByRole('button', { name: 'Bloquear' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Bloquear' }).click();

    await expect(card(page, 'a1')).toHaveCount(0);
    await expect(page.locator('.ml-toast')).toHaveText('1 anuncio de u1 ocultado');

    // Quedan 100, 100 y 400: la media cuenta los precios repetidos
    await expect(page.locator('#wallapop-average-price-display')).toContainText('200 €');
    await expect(card(page, 'a2').locator('.wallapop-price-indicator')).toHaveText('−100 €');

    await page.locator('#ml-tab').click();
    await expect(page.locator('#ml-blocked')).toHaveText('1 · 1 anuncio');
  });

  test('la × oculta un anuncio suelto', async ({ search: page }) => {
    await card(page, 'a4').getByRole('button', { name: /Ocultar este anuncio/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Ocultar' }).click();

    await expect(card(page, 'a4')).toHaveCount(0);
    await expect(page.locator('#wallapop-average-price-display')).toContainText('167 €');
  });
});

test.describe('Popup', () => {
  test('muestra nombre y versión', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.getByRole('heading', { name: 'MarketLens' })).toBeVisible();
    await expect(popup.locator('#version')).toHaveText('Versión 1.0.0');
    // Abierto fuera de Wallapop avisa de que hay que abrir una búsqueda
    await expect(popup.locator('#connection')).toHaveText('Abre una búsqueda en Wallapop');
  });
});

test.describe('Capturas', () => {
  for (const scheme of ['light', 'dark']) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test(`panel abierto (${scheme})`, async ({ search: page }, testInfo) => {
        await page.locator('#ml-tab').click();
        await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: testInfo.outputPath(`panel-${scheme}.png`) });
        expect(page.url()).toBe(SEARCH_URL);
      });
    });
  }
});
