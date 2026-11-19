import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const GAS = 'https://script.google.com/macros/s/TESTDEPLOY/exec';
const TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz';

const fields = (name: string, email: string) => ({
  name_zh: name, name_en: '', title_zh: '經理', title_en: '', department: '', company_zh: '範例公司',
  company_en: '', company_short: '範例', mobile: '+886912000000', phone: '', phone_ext: '', fax: '',
  email, website: '', address_zh: '', address_en: '', line_id: '', linkedin: '', other_social: ''
});
const card = (box: number[], name: string, email: string, low: string[] = []) => ({
  fields: fields(name, email), box_2d: box, orientation: '0', side: 'front', lowConfidenceFields: low, warnings: []
});
const THREE = [
  card([50, 30, 450, 470], '王小明', 'a@x.com', ['emails']),
  card([50, 530, 450, 970], '陳大文', 'b@x.com'),
  card([550, 30, 950, 470], '林美玲', 'c@x.com')
];

async function photo(page: Page): Promise<Buffer> {
  await page.setContent(`<body style="margin:0;background:#654">
    ${[[20, 20], [20, 420], [320, 20]].map(([t, l]) => `<div style="position:absolute;top:${t}px;left:${l}px;width:340px;height:200px;background:#fff;font:20px sans-serif;padding:20px">名片 測試</div>`).join('')}
  </body>`);
  await page.setViewportSize({ width: 800, height: 600 });
  return page.screenshot({ type: 'jpeg' });
}

async function mockGas(page: Page, recognize: (body: Record<string, unknown>) => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  await page.route(GAS, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    calls.push(body);
    let data: unknown;
    if (body.action === 'ping') data = { version: '0.1.0', sheetOk: true, driveOk: true, providers: ['claude', 'gemini'], defaultProvider: 'claude' };
    else if (body.action === 'recognize') data = recognize(body);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  });
  return calls;
}

async function configure(page: Page, provider: 'Claude' | '比較模式') {
  await page.goto('settings');
  await page.getByTestId('gas-url').fill(GAS);
  await page.getByTestId('token').fill(TOKEN);
  await page.getByTestId('test-connection').click();
  await expect(page.getByTestId('status')).toContainText('連線成功');
  await page.getByLabel(new RegExp(provider)).check();
}

test('單一引擎：3 張名片、調整框、刪除、重新整理後草稿仍在', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  const calls = await mockGas(page, (b) => ({ provider: b.provider, model: 'claude-opus-5-5', latencyMs: 10, usage: {}, cards: THREE, warnings: [] }));
  await configure(page, 'Claude');

  await page.getByRole('link', { name: /掃描/ }).first().click();
  await page.getByTestId('input-gallery').setInputFiles({ name: 'cards.jpg', mimeType: 'image/jpeg', buffer: img });
  await expect(page).toHaveURL(/review\//);
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(3);

  const rec = calls.find((c) => c.action === 'recognize')!;
  expect(rec.token).toBe(TOKEN);
  expect((rec.image as { mime: string }).mime).toBe('image/jpeg');

  // 低信心欄位提示
  await expect(page.getByTestId('field-1-email').locator('..')).toHaveClass(/low/);

  // 拖曳第 1 張框的右下角
  const crop1 = page.getByTestId('crop-1');
  await expect(crop1).toBeVisible();
  const before = await crop1.getAttribute('data-box');
  const handle = page.getByTestId('handle-br');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 40, hb.y + hb.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await expect(crop1).not.toHaveAttribute('data-box', before!);

  // 修改欄位、刪除第 3 張
  await page.getByTestId('field-2-name_zh').fill('陳大華');
  await page.getByTestId('delete-3').click();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(2);

  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(2);
  await expect(page.getByTestId('field-2-name_zh')).toHaveValue('陳大華');
  await expect(page.getByTestId('crop-1')).not.toHaveAttribute('data-box', before!);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/review.png`, fullPage: true });
});

test('比較模式：逐張選用其中一家', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  await mockGas(page, () => ({
    compareGroupId: 'g1',
    results: {
      claude: { provider: 'claude', model: 'c', latencyMs: 1, usage: {}, cards: THREE.slice(0, 2), warnings: [] },
      gemini: { provider: 'gemini', model: 'g', latencyMs: 1, usage: {}, cards: [card([52, 28, 452, 468], '王曉明', 'a@x.com'), THREE[2]], warnings: [] }
    }
  }));
  await configure(page, '比較模式');
  await page.goto('scan');
  await page.getByTestId('input-camera').setInputFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: img });
  await expect(page).toHaveURL(/review\//);
  await expect(page.locator('[data-testid^="compare-row-"]')).toHaveCount(3);
  // 第 1 列改用 Gemini
  await page.getByTestId('compare-row-1').getByRole('radio').nth(1).check();
  await page.getByTestId('use-picked').click();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(3);
  await expect(page.getByTestId('field-1-name_zh')).toHaveValue('王曉明');
});

test('後端錯誤：顯示原因且可重試', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  let fail = true;
  await page.route(GAS, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.action === 'ping') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { version: '1', sheetOk: true, driveOk: true, providers: ['claude'] } }) });
    if (fail) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'AI_ERROR', message: 'Claude 目前忙碌，請稍後再試' } }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: { provider: 'claude', model: 'm', cards: [THREE[0]] } }) });
  });
  await configure(page, 'Claude');
  await page.goto('scan');
  await page.getByTestId('input-gallery').setInputFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: img });
  await expect(page.locator('.progress-list')).toContainText('Claude 目前忙碌');
  fail = false;
  await page.getByRole('link', { name: '重試' }).click();
  await page.getByRole('button', { name: '重新辨識' }).click();
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(1);
});

test('PWA manifest 與離線 App shell', async ({ page, context }) => {
  await page.goto('');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? (await fetch(href)).json() : null;
  });
  expect(manifest.name).toBe('名片夾');
  expect(manifest.display).toBe('standalone');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '名片夾' })).toBeVisible();
  await context.setOffline(false);
});
