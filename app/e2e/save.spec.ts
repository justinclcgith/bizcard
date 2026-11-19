/**
 * P4/P5 端到端：用 gas/tests/fakeGas.mjs（真正的 GAS 程式碼跑在記憶體試算表上）當後端，
 * 只有 recognize 由測試自行回應（不呼叫 AI）。
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
// @ts-expect-error 後端測試輔助程式是純 JavaScript
import { makeGas } from '../../gas/tests/fakeGas.mjs';

const GAS = 'https://script.google.com/macros/s/TESTDEPLOY/exec';
const TOKEN = 'test-token-abcdefghijklmnopqrstuvwxyz';

type Fields = Record<string, string>;
const fields = (over: Fields): Fields => ({
  name_zh: '', name_en: '', title_zh: '', title_en: '', department: '', company_zh: '', company_en: '',
  company_short: '', mobile: '', phone: '', phone_ext: '', fax: '', email: '', website: '', address_zh: '',
  address_en: '', line_id: '', linkedin: '', other_social: '', ...over
});
const card = (box: number[], f: Fields) => ({ fields: fields(f), box_2d: box, orientation: '0', side: 'front', lowConfidenceFields: [], warnings: [] });

const WANG = { name_zh: '王小明', company_zh: '範例生技股份有限公司', company_short: '範例', title_zh: '經理', mobile: '+886912000001', email: 'wang@example.com', address_zh: '臺北市信義區市府路1號' };
const CHEN = { name_zh: '陳大文', company_zh: '測試科技', title_zh: '工程師', mobile: '+886912000002', email: 'chen@example.com' };

interface FakeGas { ctx: { doPost: (e: unknown) => { body: string } }; advance: (ms: number) => void }

async function backend(page: Page, recognize: (body: Record<string, unknown>) => unknown) {
  const g = makeGas({ props: { APP_TOKEN: TOKEN } }) as FakeGas;
  const actions: string[] = [];
  await page.route(GAS, async (route) => {
    const raw = route.request().postData() ?? '{}';
    const body = JSON.parse(raw) as Record<string, unknown>;
    actions.push(String(body.action));
    g.advance(1000);
    if (body.action === 'recognize') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: recognize(body) }) });
    }
    return route.fulfill({ contentType: 'application/json', body: g.ctx.doPost({ postData: { contents: raw } }).body });
  });
  return { g, actions };
}

async function photo(page: Page): Promise<Buffer> {
  await page.setContent(`<body style="margin:0;background:#654">
    <div style="position:absolute;top:20px;left:20px;width:340px;height:200px;background:#fff;font:20px sans-serif;padding:20px">名片 A</div>
    <div style="position:absolute;top:20px;left:420px;width:340px;height:200px;background:#eef;font:20px sans-serif;padding:20px">名片 B</div>
  </body>`);
  await page.setViewportSize({ width: 800, height: 600 });
  return page.screenshot({ type: 'jpeg' });
}

async function configure(page: Page) {
  await page.goto('settings');
  await page.getByTestId('gas-url').fill(GAS);
  await page.getByTestId('token').fill(TOKEN);
  await page.getByTestId('test-connection').click();
  await expect(page.getByTestId('status')).toContainText('連線成功');
  await page.getByLabel(/^Claude$/).check();
}

const recog = (cards: unknown[]) => () => ({ provider: 'claude', model: 'claude-opus-5-5', latencyMs: 5, usage: {}, cards, warnings: [] });

async function scan(page: Page, img: Buffer) {
  await page.goto('scan');
  await page.getByTestId('input-gallery').setInputFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: img });
  await expect(page).toHaveURL(/review\//);
}

test('儲存 → 清單 → 搜尋 → 詳情 → 編輯職稱 → 刪除', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  const { actions } = await backend(page, recog([card([50, 20, 400, 480], WANG), card([50, 520, 400, 980], CHEN)]));
  await configure(page);
  await scan(page, img);

  await page.getByLabel('標籤').fill('展會, 客戶');
  await page.getByLabel('場合', { exact: true }).fill('BIO Asia 2026');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('flash')).toContainText('已儲存 2 張');
  expect(actions).toContain('findDuplicates');
  await expect(page.getByTestId('contact-list').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('drafts')).toHaveCount(0);

  // 搜尋：電話用 09 開頭、標籤篩選
  await page.getByTestId('search').fill('0912000002');
  await expect(page.getByTestId('contact-list').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('contact-list')).toContainText('陳大文');
  await page.getByTestId('search').fill('');
  await page.getByRole('button', { name: '#展會' }).click();
  await expect(page.getByTestId('contact-list').locator('li')).toHaveCount(2);

  // 詳情
  await page.getByRole('link', { name: /王小明/ }).click();
  await expect(page.getByTestId('contact-name')).toHaveText('王小明');
  await expect(page.getByTestId('act-tel')).toHaveAttribute('href', 'tel:+886912000001');
  await expect(page.getByTestId('act-mail')).toHaveAttribute('href', 'mailto:wang@example.com');
  await expect(page.getByTestId('act-map')).toHaveAttribute('href', /google\.com\/maps.*%E8%87%BA%E5%8C%97/);
  await expect(page.getByTestId('card-image').first()).toBeVisible();
  await expect(page.getByTestId('timeline').locator('li')).toHaveCount(1);

  // 編輯職稱並記錄為異動 → 時間軸兩筆
  await page.getByTestId('edit').click();
  await page.getByTestId('edit-title_zh').fill('協理');
  await expect(page.getByTestId('record-title')).toBeChecked();
  await page.getByTestId('edit-save').click();
  await expect(page.locator('.notice.ok')).toContainText('已儲存');
  await expect(page.getByTestId('timeline').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('timeline')).toContainText('經理');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/contact.png`, fullPage: true });

  // 刪除（兩段式確認）
  await page.getByTestId('delete').click();
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId('flash')).toContainText('已刪除 王小明');
  await expect(page.getByTestId('contact-list').locator('li')).toHaveCount(1);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/home.png`, fullPage: true });
});

test('再掃同一人的新名片：提示疑似同一人，合併後寫入職稱歷程', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  let cards = [card([50, 20, 400, 480], WANG)];
  await backend(page, () => recog(cards)());
  await configure(page);
  await scan(page, img);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('flash')).toContainText('已儲存 1 張');

  cards = [card([50, 20, 400, 480], { ...WANG, title_zh: '副總經理', company_zh: '新創生醫', company_short: '新創' })];
  await scan(page, img);
  await page.getByTestId('save').click();
  const dialog = page.getByTestId('dup-dialog');
  await expect(dialog).toContainText('王小明');
  await expect(dialog).toContainText('Email 相同');
  await expect(dialog).toContainText('副總經理');
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/duplicate.png` });
  await page.getByTestId('dup-confirm').click();
  await expect(page.getByTestId('flash')).toContainText('合併到既有聯絡人');
  await expect(page.getByTestId('contact-list').locator('li')).toHaveCount(1);
  await page.getByRole('link', { name: /王小明/ }).click();
  await expect(page.getByTestId('timeline').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('timeline')).toContainText('副總經理');
  await expect(page.getByTestId('timeline')).toContainText('範例');
});

test('選擇「不是同一人」則新增聯絡人', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  await backend(page, recog([card([50, 20, 400, 480], WANG)]));
  await configure(page);
  await scan(page, img);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('flash')).toBeVisible();
  await scan(page, img);
  await page.getByTestId('save').click();
  await page.getByTestId('dup-dialog').getByText('不是同一人').click();
  await page.getByTestId('dup-confirm').click();
  await expect(page.getByTestId('contact-list').locator('li')).toHaveCount(2);
});

test('加拍背面：空白欄位補上、衝突欄位可選', async ({ page, browser }) => {
  const img = await photo(await browser.newPage());
  await backend(page, (b) => recog(b.side === 'back'
    ? [card([0, 0, 1000, 1000], { name_en: 'Hsiao-Ming Wang', email: 'hm.wang@example.com' })]
    : [card([50, 20, 400, 480], WANG)])());
  await configure(page);
  await scan(page, img);
  await page.getByTestId('back-1').setInputFiles({ name: 'back.jpg', mimeType: 'image/jpeg', buffer: img });
  const dlg = page.getByTestId('back-conflicts');
  await expect(dlg).toContainText('wang@example.com');
  await dlg.getByLabel(/背面：hm\.wang/).check();
  await page.getByTestId('back-done').click();
  await expect(page.getByTestId('field-1-email')).toHaveValue('hm.wang@example.com');
  await expect(page.getByTestId('field-1-name_en')).toHaveValue('Hsiao-Ming Wang');
  await page.getByTestId('save').click();
  await expect(page.getByTestId('flash')).toBeVisible();
  await page.getByRole('link', { name: /王小明/ }).click();
  await expect(page.getByTestId('card-image')).toHaveCount(2);
});

test('離線拍照排入待辨識，恢復連線後自動送出', async ({ page, browser, context }) => {
  const img = await photo(await browser.newPage());
  const { actions } = await backend(page, recog([card([50, 20, 400, 480], CHEN)]));
  await configure(page);
  await page.goto('scan');
  await context.setOffline(true);
  await page.getByTestId('input-gallery').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: img },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: img }
  ]);
  await expect(page.locator('.progress-list li')).toHaveCount(2);
  await expect(page.locator('.progress-list')).toContainText('已排入待辨識');
  expect(actions.filter((a) => a === 'recognize')).toHaveLength(0);
  await page.getByRole('link', { name: /名片夾/ }).click();
  await expect(page.getByTestId('drafts')).toContainText('待辨識（離線）');
  await context.setOffline(false);
  await expect(page.getByTestId('drafts')).toContainText('1 張待確認');
  await expect(page.getByTestId('drafts').locator('li', { hasText: '待辨識' })).toHaveCount(0);
  expect(actions.filter((a) => a === 'recognize')).toHaveLength(2);
});
