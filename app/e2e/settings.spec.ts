import { test, expect, devices } from '@playwright/test';

const GAS = 'https://script.google.com/a/example.com/macros/s/TESTDEPLOY/exec';
const TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz';

test('Chrome：關掉重開後仍記得後端設定', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto('settings');
  await page.getByTestId('gas-url').fill(GAS);
  await page.getByTestId('token').fill(TOKEN);
  await page.close();
  const again = await context.newPage();
  await again.goto('');
  await again.goto('settings');
  await expect(again.getByTestId('gas-url')).toHaveValue(GAS);
  await expect(again.getByTestId('token')).toHaveValue(TOKEN);
  await context.close();
});

test('LINE 內建瀏覽器：要求改用 Chrome 開啟', async ({ browser }) => {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    userAgent: `${devices['Pixel 7'].userAgent} Line/15.20.1/IAB`
  });
  const page = await context.newPage();
  await page.goto('settings');
  await expect(page).toHaveURL(/openExternalBrowser=1/);
  await expect(page.getByRole('heading', { name: '請改用 Chrome 開啟' })).toBeVisible();
  await expect(page.getByRole('link', { name: '用 Chrome 開啟' })).toHaveAttribute('href', /openExternalBrowser=1/);
  await context.close();
});
