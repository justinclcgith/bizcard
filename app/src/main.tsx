import { render } from 'preact';
import { ErrorBoundary, LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { Home } from './pages/Home';
import { Scan } from './pages/Scan';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { Contact } from './pages/Contact';
import { runQueued } from './lib/flow';
import { BASE, to } from './lib/paths';
import { externalBrowserUrl, isLineInApp } from './lib/inApp';
import './styles.css';

function Nav() {
  const { path } = useLocation();
  const item = (p: string, label: string, icon: string) => {
    const href = to(p);
    const active = p === '' ? path === BASE || path === BASE.replace(/\/$/, '') : path.startsWith(href);
    return <a href={href} class={active ? 'active' : ''} aria-current={active ? 'page' : undefined}><span>{icon}</span>{label}</a>;
  };
  return (
    <nav class="bottom-nav">
      {item('', '名片夾', '📇')}
      {item('scan', '掃描', '📷')}
      {item('settings', '設定', '⚙️')}
    </nav>
  );
}

function NotFound() {
  return <section class="page"><p>找不到頁面。</p><a href={to('')}>回首頁</a></section>;
}

/** 在 LINE 內建瀏覽器中開啟時的提示（自動轉到 Chrome 失敗時才會看到）。 */
function InAppNotice() {
  return (
    <section class="page">
      <h1>請改用 Chrome 開啟</h1>
      <p class="notice error">你現在是在 LINE 的內建瀏覽器裡。這裡不會記住後端設定，每次都要重新輸入，也無法安裝成 App。</p>
      <a class="big-button" href={externalBrowserUrl(location.href)}>用 Chrome 開啟</a>
      <p class="hint">如果按了沒反應，請點右上角「⋮」→「使用預設瀏覽器開啟」。在 Chrome 打開後，建議用選單「安裝應用程式」，之後從主畫面的「名片夾」圖示開啟。</p>
    </section>
  );
}

function App() {
  if (isLineInApp(navigator.userAgent)) return <InAppNotice />;
  return (
    <LocationProvider>
      <ErrorBoundary>
        <main>
          <Router>
            <Route path={BASE} component={Home} />
            <Route path={to('scan')} component={Scan} />
            <Route path={to('review/:id')} component={Review} />
            <Route path={to('contact/:id')} component={Contact} />
            <Route path={to('settings')} component={Settings} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <Nav />
      </ErrorBoundary>
    </LocationProvider>
  );
}

// 恢復連線時自動送出待辨識照片（docs/01 F4.3）
window.addEventListener('online', () => { void runQueued(); });

// LINE 內建瀏覽器：直接請 LINE 改用預設瀏覽器開啟
if (isLineInApp(navigator.userAgent) && !new URL(location.href).searchParams.has('openExternalBrowser')) {
  location.replace(externalBrowserUrl(location.href));
}

render(<App />, document.getElementById('app')!);
