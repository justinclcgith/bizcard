/** 設定頁：後端網址、權杖、辨識引擎（docs/01 F7）。 */
import { useState } from 'preact/hooks';
import { ping } from '../api/client';
import { errorMessage } from '../lib/flow';
import { isValidGasUrl, loadSettings, parseSetupPayload, saveSettings } from '../lib/settings';
import type { Settings as S } from '../lib/settings';
import type { ProviderChoice } from '../lib/types';

declare global {
  interface Window { BarcodeDetector?: new (opts: { formats: string[] }) => { detect(src: ImageBitmapSource): Promise<Array<{ rawValue: string }>> } }
}

export function Settings() {
  const [s, setS] = useState<S>(loadSettings());
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const persist = (next: S) => {
    setS(next);
    if (!saveSettings(next)) setStatus({ ok: false, text: '無法儲存設定（瀏覽器可能封鎖本機儲存）' });
  };

  async function test() {
    setTesting(true);
    setStatus(null);
    try {
      const r = await ping({ gasUrl: s.gasUrl.trim(), token: s.token.trim() });
      const parts = [`連線成功（後端 ${r.version}）`];
      parts.push(r.sheetOk ? '試算表正常' : '試算表未設定，請在 Apps Script 執行 setup()');
      parts.push(r.driveOk ? 'Drive 資料夾正常' : 'Drive 資料夾未設定');
      parts.push(r.providers.length ? `可用引擎：${r.providers.join('、')}` : '尚未設定任何 AI 金鑰');
      setStatus({ ok: r.sheetOk && r.driveOk && r.providers.length > 0, text: parts.join('；') });
    } catch (e) {
      setStatus({ ok: false, text: errorMessage(e) });
    }
    setTesting(false);
  }

  function applyPayload(text: string): boolean {
    const p = parseSetupPayload(text);
    if (!p) return false;
    persist({ ...s, ...p });
    setStatus({ ok: true, text: '已匯入設定，請按「測試連線」' });
    return true;
  }

  async function scanQr(file: File | undefined) {
    if (!file) return;
    if (!window.BarcodeDetector) {
      setStatus({ ok: false, text: '這個瀏覽器不支援掃描 QR code，請改用貼上' });
      return;
    }
    try {
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const codes = await det.detect(await createImageBitmap(file));
      if (!codes[0] || !applyPayload(codes[0].rawValue)) setStatus({ ok: false, text: '照片中沒有可用的設定 QR code' });
    } catch {
      setStatus({ ok: false, text: '讀取 QR code 失敗' });
    }
  }

  const urlInvalid = s.gasUrl !== '' && !isValidGasUrl(s.gasUrl);

  return (
    <section class="page">
      <h1>設定</h1>
      <fieldset>
        <legend>後端連線</legend>
        <label class="field">
          <span>後端網址（Apps Script 部署網址）</span>
          <input value={s.gasUrl} inputMode="url" placeholder="https://script.google.com/macros/s/…/exec"
            data-testid="gas-url" onInput={(e) => persist({ ...s, gasUrl: (e.target as HTMLInputElement).value.trim() })} />
        </label>
        {urlInvalid && <p class="notice error">網址格式不正確，應為 https://script.google.com/macros/s/…/exec</p>}
        <label class="field">
          <span>存取權杖</span>
          <input type={showToken ? 'text' : 'password'} value={s.token} autoComplete="off"
            data-testid="token" onInput={(e) => persist({ ...s, token: (e.target as HTMLInputElement).value.trim() })} />
        </label>
        <label class="check"><input type="checkbox" checked={showToken} onChange={() => setShowToken(!showToken)} /> 顯示權杖</label>
        <div class="row">
          <button onClick={test} disabled={testing || !s.gasUrl || !s.token} data-testid="test-connection">
            {testing ? '測試中…' : '測試連線'}
          </button>
          <label class="button secondary">
            掃描設定 QR code
            <input type="file" accept="image/*" capture="environment" hidden
              onChange={(e) => scanQr((e.target as HTMLInputElement).files?.[0])} />
          </label>
          <button class="secondary" onClick={async () => {
            try {
              const t = await navigator.clipboard.readText();
              if (!applyPayload(t)) setStatus({ ok: false, text: '剪貼簿內容不是有效的設定' });
            } catch { setStatus({ ok: false, text: '無法讀取剪貼簿' }); }
          }}>從剪貼簿貼上設定</button>
        </div>
        {status && <p class={status.ok ? 'notice ok' : 'notice error'} data-testid="status">{status.text}</p>}
      </fieldset>

      <fieldset>
        <legend>辨識引擎</legend>
        {([['claude', 'Claude'], ['gemini', 'Gemini'], ['compare', '比較模式（同時送兩家，費用加倍）']] as Array<[ProviderChoice, string]>).map(([v, label]) => (
          <label key={v} class="check">
            <input type="radio" name="provider" checked={s.provider === v} onChange={() => persist({ ...s, provider: v })} />
            {label}
          </label>
        ))}
      </fieldset>
      <p class="muted small">權杖只存在這支手機的瀏覽器中，不會上傳到其他地方。</p>
    </section>
  );
}
