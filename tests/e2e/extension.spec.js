const { test, expect, card, visibleIds } = require('./fixtures');

// Abre el panel y despliega la configuración
async function openSettings(page) {
  await page.locator('#ml-tab').click();
  const settings = page.locator('#ml-settings');
  if (!(await settings.evaluate((element) => element.open))) {
    await settings.locator('summary').click();
  }
}

// El interruptor real está oculto: se pulsa su etiqueta
const featureSwitch = (page, key) => page.locator(`label.ml-switch:has(input[data-feature="${key}"])`);
const featureInput = (page, key) => page.locator(`input[data-feature="${key}"]`);

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
    // No quedan celdas vacías en la cuadrícula
    await expect(page.locator('#grid > :visible')).toHaveCount(2);

    await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
    expect(await visibleIds(page)).toEqual(['a1', 'a3']);

    await page.getByRole('button', { name: 'Todos', exact: true }).click();
    expect(await visibleIds(page)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  test('el interruptor pausa el filtro y lo recuerda al recargar', async ({ search: page }) => {
    await openSettings(page);
    await page.getByRole('button', { name: 'Reservados', exact: true }).click();

    await featureSwitch(page, 'filter').click();
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

});

test.describe('Ocultar anuncios', () => {
  const hideButton = (page, id) => card(page, id).getByRole('button', { name: /Ocultar este anuncio/ });
  const showButton = (page, id) => card(page, id).getByRole('button', { name: 'Mostrar anuncio' });

  test('cada tarjeta tiene su botón, colocado sobre la propia tarjeta', async ({ search: page }) => {
    for (const id of ['a1', 'a2', 'a3', 'a4']) {
      await expect(hideButton(page, id)).toBeVisible();
    }
    // El botón cuelga de la tarjeta, no del bloque del precio
    const parents = await page.locator('.wallapop-delete-ad-btn').evaluateAll((buttons) =>
      buttons.map((button) => button.parentElement.matches('a.item-card_ItemCard--vertical__CNrfk, article[class*="ItemCard"]'))
    );
    expect(parents).toEqual([true, true, true, true]);
  });

  test('la × oculta al momento, sin diálogo, y deja un ojo para volver a mostrarlo', async ({ search: page }) => {
    await hideButton(page, 'a4').click();

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(card(page, 'a4')).toHaveClass(/ml-ad-hidden/);
    await expect(card(page, 'a4').locator('h3')).toBeHidden();
    await expect(showButton(page, 'a4')).toBeVisible();
    await expect(showButton(page, 'a4')).toHaveAttribute('aria-pressed', 'true');

    // Queda un hueco compacto, y la media ya no lo cuenta
    const box = await card(page, 'a4').boundingBox();
    expect(box.height).toBeLessThanOrEqual(50);
    await expect(page.locator('#wallapop-average-price-display')).toContainText('167 €');
    await expect(page.locator('#wallapop-average-price-display')).toContainText('3 anuncios');
    await expect(card(page, 'a1').locator('.wallapop-price-indicator')).toHaveText('+133 €');

    // El ojo lo vuelve a mostrar
    await showButton(page, 'a4').click();
    await expect(card(page, 'a4')).not.toHaveClass(/ml-ad-hidden/);
    await expect(card(page, 'a4').locator('h3')).toBeVisible();
    await expect(hideButton(page, 'a4')).toBeVisible();
    await expect(page.locator('#wallapop-average-price-display')).toContainText('225 €');
    await expect(page.locator('#wallapop-average-price-display')).toContainText('4 anuncios');
  });

  test('un anuncio oculto no se abre al pulsar su hueco', async ({ search: page }) => {
    await hideButton(page, 'a1').click();
    await expect(card(page, 'a1')).toHaveCSS('pointer-events', 'none');
    await expect(showButton(page, 'a1')).toHaveCSS('pointer-events', 'auto');
  });

  test('los ocultos sobreviven a una recarga y el panel los muestra todos', async ({ search: page }) => {
    await hideButton(page, 'a3').click();
    await hideButton(page, 'a4').click();

    await page.reload();
    await expect(card(page, 'a3')).toHaveClass(/ml-ad-hidden/, { timeout: 15_000 });
    await expect(card(page, 'a4')).toHaveClass(/ml-ad-hidden/);
    await expect(card(page, 'a1')).not.toHaveClass(/ml-ad-hidden/);
    await expect(page.locator('#wallapop-average-price-display')).toContainText('200 €', { timeout: 15_000 });

    await page.locator('#ml-tab').click();
    await expect(page.locator('#ml-hidden-count')).toHaveText('2 en esta página');

    // Mostrar todos afecta también a otras búsquedas: pide confirmación
    await page.locator('#ml-show-hidden').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Volverán a verse 2 anuncios');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.locator('.ml-ad-hidden')).toHaveCount(2);

    await page.locator('#ml-show-hidden').click();
    await dialog.getByRole('button', { name: 'Mostrar' }).click();
    await expect(page.locator('.ml-ad-hidden')).toHaveCount(0);
    await expect(page.locator('#ml-hidden-count')).toHaveText('0 en esta página');
    await expect(page.locator('#ml-show-hidden')).toBeDisabled();
  });

  test('borra las marcas de la antigua función "visto"', async ({ context, search: page }) => {
    const [worker] = context.serviceWorkers();
    await worker.evaluate(() => chrome.storage.local.set({ seenItems: ['/item/a1'] }));

    await page.reload();
    await expect(page.locator('#ml-tab')).toBeVisible();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('seenItems')).seenItems))
      .toBeUndefined();
    await expect(page.locator('.ml-seen-btn, .ml-seen-veil')).toHaveCount(0);
  });
});

test.describe('Configuración', () => {
  test('hay un interruptor por función, todos activos de serie', async ({ search: page }) => {
    await openSettings(page);
    for (const key of ['filter', 'prices', 'sellers', 'blocking', 'hide']) {
      await expect(featureInput(page, key)).toBeChecked();
    }
    await expect(page.locator('#ml-settings input[data-feature]')).toHaveCount(5);
  });

  test('análisis de precios', async ({ search: page }) => {
    await expect(card(page, 'a1').locator('.wallapop-price-indicator')).toBeVisible();
    await openSettings(page);
    await expect(page.locator('#ml-avg-price')).toBeVisible();

    await featureSwitch(page, 'prices').click();
    await expect(page.locator('.wallapop-price-indicator').first()).toBeHidden();
    await expect(page.locator('#wallapop-average-price-display')).toBeHidden();
    await expect(page.locator('#ml-avg-price')).toBeHidden();
    await expect(page.locator('#ml-price-range')).toBeHidden();

    await featureSwitch(page, 'prices').click();
    await expect(card(page, 'a1').locator('.wallapop-price-indicator')).toBeVisible();
    await expect(page.locator('#wallapop-average-price-display')).toBeVisible();
  });

  test('vendedor de cada anuncio; sin él no se puede bloquear', async ({ search: page }) => {
    await openSettings(page);
    await expect(featureInput(page, 'blocking')).toBeEnabled();

    await featureSwitch(page, 'sellers').click();
    await expect(card(page, 'a1').locator('.wallapop-user-id-container')).toBeHidden();
    await expect(featureInput(page, 'blocking')).toBeDisabled();

    await featureSwitch(page, 'sellers').click();
    await expect(card(page, 'a1').locator('.wallapop-user-id-display')).toBeVisible();
    await expect(featureInput(page, 'blocking')).toBeEnabled();
  });

  test('bloquear vendedores', async ({ search: page }) => {
    await openSettings(page);
    await featureSwitch(page, 'blocking').click();

    await expect(card(page, 'a1').getByRole('button', { name: 'Bloquear' })).toBeHidden();
    // El ID sigue visible: solo se quita la acción
    await expect(card(page, 'a1').locator('.wallapop-user-id-display')).toBeVisible();
    await expect(page.locator('#ml-blocked')).toBeHidden();

    await featureSwitch(page, 'blocking').click();
    await expect(card(page, 'a1').getByRole('button', { name: 'Bloquear' })).toBeVisible();
  });

  test('ocultar anuncios', async ({ search: page }) => {
    const hideButton = card(page, 'a1').getByRole('button', { name: /Ocultar este anuncio/ });
    await card(page, 'a2').getByRole('button', { name: /Ocultar este anuncio/ }).click();
    await expect(card(page, 'a2')).toHaveClass(/ml-ad-hidden/);
    await openSettings(page);

    // Desactivada: sin botones, sin fila en el panel y los ocultos vuelven a verse
    await featureSwitch(page, 'hide').click();
    await expect(hideButton).toBeHidden();
    await expect(page.locator('#ml-hidden-count')).toBeHidden();
    await expect(card(page, 'a2')).not.toHaveClass(/ml-ad-hidden/);
    await expect(page.locator('#wallapop-average-price-display')).toContainText('4 anuncios');

    // Al reactivarla, lo que estaba oculto sigue oculto
    await featureSwitch(page, 'hide').click();
    await expect(hideButton).toBeVisible();
    await expect(card(page, 'a2')).toHaveClass(/ml-ad-hidden/);
    await expect(page.locator('#wallapop-average-price-display')).toContainText('3 anuncios');
  });

  test('la configuración se guarda por usuario y sobrevive a una recarga', async ({ search: page }) => {
    await openSettings(page);
    await featureSwitch(page, 'prices').click();
    await featureSwitch(page, 'hide').click();

    await page.reload();
    await expect(page.locator('#ml-tab')).toBeVisible();
    await expect(page.locator('.wallapop-user-id-container').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('html')).toHaveClass(/ml-off-prices/);
    await expect(page.locator('html')).toHaveClass(/ml-off-hide/);
    await expect(page.locator('html')).not.toHaveClass(/ml-off-sellers/);
    await expect(page.locator('.wallapop-price-indicator').first()).toBeHidden();
    await expect(card(page, 'a1').getByRole('button', { name: /Ocultar este anuncio/ })).toBeHidden();

    await openSettings(page);
    await expect(featureInput(page, 'prices')).not.toBeChecked();
    await expect(featureInput(page, 'hide')).not.toBeChecked();
    await expect(featureInput(page, 'sellers')).toBeChecked();
  });

  test('el desplegable de configuración es accesible por teclado', async ({ search: page }) => {
    await page.locator('#ml-tab').click();
    await page.locator('#ml-settings summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#ml-settings')).toHaveJSProperty('open', true);
  });
});

test.describe('Seguridad de los mensajes entre inject.js y la extensión', () => {
  test('inject.js envía los mensajes solo al origen de la página', async ({ context, searchUrl }) => {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__sentMessages = [];
      const original = window.postMessage.bind(window);
      window.postMessage = (message, targetOrigin, ...rest) => {
        if (message?.type?.startsWith('WALLAPOP_')) {
          window.__sentMessages.push({ type: message.type, targetOrigin });
        }
        return original(message, targetOrigin, ...rest);
      };
    });
    await page.goto(searchUrl);

    await expect.poll(() => page.evaluate(() => window.__sentMessages.length), { timeout: 15_000 }).toBeGreaterThan(0);
    const sent = await page.evaluate(() => window.__sentMessages);

    expect(sent.map((message) => message.type)).toEqual(
      expect.arrayContaining(['WALLAPOP_USER_IDS', 'WALLAPOP_ITEMS_MATCHING'])
    );
    for (const message of sent) {
      expect(message.targetOrigin).toBe('https://es.wallapop.com');
    }
  });

  test('ignora los mensajes que no vienen de la propia página', async ({ search: page }) => {
    await page.evaluate(() => {
      window.addCard({ id: 'a5', title: 'Cebo', price: '50 €' });
      window.addCard({ id: 'a6', title: 'Control', price: '60 €' });

      const fakeMessage = (userId, imageId) => ({
        type: 'WALLAPOP_ITEMS_MATCHING',
        items: [{ user_id: userId, title: 'x', id: imageId, image_url: `https://cdn.wallapop.com/images/${imageId}.svg` }]
      });

      // Falsificado: lo envía un iframe aislado (otro origen y otra ventana)
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.srcdoc = `<script>parent.postMessage(${JSON.stringify(fakeMessage('intruso', 'a5'))}, '*')<\/script>`;
      document.body.appendChild(frame);

      // Legítimo (control): lo envía la propia página a su origen, como hace inject.js
      window.postMessage(fakeMessage('legitimo', 'a6'), window.location.origin);
    });

    // El legítimo se acepta: así sabemos que la extensión ya ha procesado los mensajes
    await expect(card(page, 'a6').locator('.wallapop-user-id-display')).toHaveText('legitimo', { timeout: 15_000 });
    // El falsificado, no
    await expect(card(page, 'a5').locator('.wallapop-user-id-container')).toHaveCount(0);
  });
});

test.describe('Popup', () => {
  test.skip(({ layout }) => layout !== 'search', 'no depende del formato de tarjeta');
  test('muestra nombre y versión', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(popup.getByRole('heading', { name: 'MarketLens' })).toBeVisible();
    await expect(popup.locator('#version')).toHaveText(`Versión ${require('../../manifest.json').version}`);
    // Abierto fuera de Wallapop avisa de que hay que abrir una búsqueda
    await expect(popup.locator('#connection')).toHaveText('Abre una búsqueda en Wallapop');
  });
});

test.describe('Capturas', () => {
  test.skip(({ layout }) => layout !== 'search', 'las capturas del README son de la búsqueda');
  for (const scheme of ['light', 'dark']) {
    test.describe(scheme, () => {
      test.use({ colorScheme: scheme });

      test(`panel abierto (${scheme})`, async ({ search: page }, testInfo) => {
        await card(page, 'a3').getByRole('button', { name: /Ocultar este anuncio/ }).click();
        await page.locator('#ml-tab').click();
        await page.getByRole('button', { name: 'Disponibles', exact: true }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: testInfo.outputPath(`panel-${scheme}.png`) });
        expect(new URL(page.url()).pathname).toBe('/search');
      });

      test(`configuración (${scheme})`, async ({ search: page }, testInfo) => {
        await page.locator('.wallapop-price-indicator').first().waitFor();
        await openSettings(page);
        await featureSwitch(page, 'hide').click();
        await page.locator('#ml-settings').scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await page.screenshot({ path: testInfo.outputPath(`settings-${scheme}.png`) });
      });
    });
  }
});
