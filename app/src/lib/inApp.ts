/**
 * 偵測 LINE 等 App 內建瀏覽器。內建瀏覽器不會保留 localStorage，
 * 每次開啟都要重新輸入後端設定，也無法安裝成 App，所以要改用 Chrome 開啟。
 */
export function isLineInApp(ua: string): boolean {
  return /\bLine\/\d/i.test(ua);
}

/** LINE 認得 openExternalBrowser=1，會改用手機預設瀏覽器開啟。 */
export function externalBrowserUrl(href: string): string {
  const u = new URL(href);
  u.searchParams.set('openExternalBrowser', '1');
  return u.toString();
}
