// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // Cada test se ejecuta con los dos formatos de tarjeta de Wallapop
  projects: [
    { name: 'busqueda', use: { layout: 'search' } },
    { name: 'perfil', use: { layout: 'profile' } }
  ]
});
