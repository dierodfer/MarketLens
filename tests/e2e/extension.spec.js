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

  test('copiar el ID avisa si el portapapeles no está disponible', async ({ search: page }) => {
    // El content script vive en un mundo aislado: hay que denegar el permiso de verdad
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Browser.setPermission', {
      permission: { name: 'clipboard-write' },
      setting: 'denied',
      origin: new URL(page.url()).origin
    });

    await card(page, 'a1').locator('.wallapop-user-id-display').click();
    await expect(page.locator('.ml-toast')).toHaveText('No se pudo copiar el ID');
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

test.describe('Marcar como visto', () => {
  const seenButton = (page, id) => card(page, id).getByRole('button', { name: /visto/ });

  test('marca el anuncio con un velo gris por encima y se puede deshacer', async ({ search: page }) => {
    await expect(card(page, 'a1').locator('.ml-seen-veil')).toHaveCount(0);

    await seenButton(page, 'a1').click();
    await expect(card(page, 'a1')).toHaveClass(/ml-seen/);
    await expect(seenButton(page, 'a1')).toHaveAttribute('aria-pressed', 'true');
    await expect(seenButton(page, 'a1')).toHaveAccessibleName('Quitar marca de visto');

    // Velo gris semitransparente que cubre toda la tarjeta y no bloquea los clics
    const veil = card(page, 'a1').locator('.ml-seen-veil');
    await expect(veil).toHaveCount(1);
    await expect(veil).toHaveCSS('background-color', /^rgba\(110, 110, 115, 0\.\d+\)$/);
    await expect(veil).toHaveCSS('pointer-events', 'none');
    const [cardBox, veilBox] = await Promise.all([card(page, 'a1').boundingBox(), veil.boundingBox()]);
    expect(veilBox).toEqual(cardBox);

    // Las demás tarjetas no cambian
    await expect(card(page, 'a2')).not.toHaveClass(/ml-seen/);

    // Volver a pulsar quita la marca
    await seenButton(page, 'a1').click();
    await expect(card(page, 'a1')).not.toHaveClass(/ml-seen/);
    await expect(card(page, 'a1').locator('.ml-seen-veil')).toHaveCount(0);
    await expect(seenButton(page, 'a1')).toHaveAccessibleName('Marcar como visto');
  });

  test('a diferencia de ocultar, el anuncio sigue en la página y respeta el filtro', async ({ search: page }) => {
    await seenButton(page, 'a2').click();
    await expect(card(page, 'a2')).toHaveCount(1);

    await page.locator('#ml-tab').click();
    await page.getByRole('button', { name: 'Reservados', exact: true }).click();
    expect(await visibleIds(page)).toEqual(['a2', 'a4']);
    await expect(card(page, 'a2')).toHaveClass(/ml-seen/);
  });

  test('las marcas sobreviven a una recarga', async ({ search: page }) => {
    await seenButton(page, 'a3').click();
    await seenButton(page, 'a4').click();

    await page.reload();
    await expect(card(page, 'a3')).toHaveClass(/ml-seen/, { timeout: 10_000 });
    await expect(card(page, 'a4')).toHaveClass(/ml-seen/);
    await expect(card(page, 'a1')).not.toHaveClass(/ml-seen/);
  });

  test('el panel cuenta los vistos y permite borrarlos todos', async ({ search: page }) => {
    await page.locator('#ml-tab').click();
    await expect(page.locator('#ml-seen-count')).toHaveText('0 en esta página');
    await expect(page.locator('#ml-clear-seen')).toBeDisabled();

    await seenButton(page, 'a1').click();
    await seenButton(page, 'a2').click();
    await expect(page.locator('#ml-seen-count')).toHaveText('2 en esta página');
    await expect(page.locator('#ml-clear-seen')).toBeEnabled();

    await page.locator('#ml-clear-seen').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Se quitará la marca de 2 anuncios');

    // Cancelar no borra nada
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.ml-seen-veil')).toHaveCount(2);

    await page.locator('#ml-clear-seen').click();
    await dialog.getByRole('button', { name: 'Borrar' }).click();
    await expect(page.locator('.ml-seen-veil')).toHaveCount(0);
    await expect(page.locator('#ml-seen-count')).toHaveText('0 en esta página');
    await expect(page.locator('#ml-clear-seen')).toBeDisabled();
  });

  test('marcar uno como visto no cambia la media de precios', async ({ search: page }) => {
    await seenButton(page, 'a4').click();
    await expect(page.locator('#wallapop-average-price-display')).toContainText('225 €');
    await expect(page.locator('#wallapop-average-price-display')).toContainText('4 anuncios');
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
        await card(page, 'a1').getByRole('button', { name: 'Marcar como visto' }).click();
        await page.locator('#ml-tab').click();
        await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: testInfo.outputPath(`panel-${scheme}.png`) });
        expect(page.url()).toBe(SEARCH_URL);
      });
    });
  }
});
