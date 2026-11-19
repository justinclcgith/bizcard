import { render } from 'preact';
import { ErrorBoundary, LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { Home } from './pages/Home';
import { Scan } from './pages/Scan';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { BASE, to } from './lib/paths';
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

function App() {
  return (
    <LocationProvider>
      <ErrorBoundary>
        <main>
          <Router>
            <Route path={BASE} component={Home} />
            <Route path={to('scan')} component={Scan} />
            <Route path={to('review/:id')} component={Review} />
            <Route path={to('settings')} component={Settings} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <Nav />
      </ErrorBoundary>
    </LocationProvider>
  );
}

render(<App />, document.getElementById('app')!);
