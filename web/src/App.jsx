import { useCallback, useEffect, useState } from 'react';
import { AdminView } from './components/admin/AdminView.jsx';
import { ToastProvider, useToast } from './components/common/Toast.jsx';
import { TopNav } from './components/layout/TopNav.jsx';
import { QAView } from './components/qa/QAView.jsx';
import { ScannerView } from './components/scanner/ScannerView.jsx';
import { MOCK_PROFILE, useScanSession } from './hooks/useScanSession.js';
import { api } from './lib/api.js';
import { downloadJSON } from './lib/format.js';

const VIEWS = ['scanner', 'qa', 'admin'];
const viewFromHash = () => VIEWS.find((v) => location.hash === `#/${v}`) ?? 'scanner';

function Shell() {
  const notify = useToast();
  const session = useScanSession({ notify });
  const [view, setViewState] = useState(viewFromHash);
  const [meta, setMeta] = useState({ ruleset: 'v1.0 Ruleset Active', profiles: [], serverInfo: null });
  const [qaLabel, setQaLabel] = useState(() => new URLSearchParams(location.search).get('label') ?? '');

  const setView = useCallback((v) => {
    setViewState(v);
    history.replaceState(null, '', `${location.pathname}${location.search}#/${v}`);
  }, []);

  useEffect(() => {
    const onHash = () => setViewState(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Khởi động: tải metadata rồi quét / mở scan / dùng mock
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    (async () => {
      let profiles = [];
      try {
        const [rules, list, info] = await Promise.all([api('/api/rules'), api('/api/profiles'), api('/api/server-info').catch(() => null)]);
        profiles = list;
        setMeta({ ruleset: `${rules.version} Ruleset Active · ${rules.rules.length} rules`, profiles: list, serverInfo: info });
      } catch {
        // Không có backend (vd chỉ chạy Vite): hiển thị dữ liệu mock
        notify('Không kết nối được backend: đang hiển thị mockData.json');
        session.loadMock();
        return;
      }
      if (params.get('mock')) session.loadMock();
      else if (params.get('scan')) session.loadScan(params.get('scan'), profiles);
      else session.scanLive();
    })();
    // chỉ chạy một lần khi mở trang
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toScanner = (fn) => (...args) => { setView('scanner'); return fn(...args); };
  const actions = {
    rescan: toScanner(() => session.scanLive(qaLabel || null)),
    simulate: toScanner(session.simulate),
    mock: toScanner(session.loadMock),
    live: toScanner(session.backToLive),
    exportReport: () => {
      const c = session.current;
      if (!c) return notify('Chưa có báo cáo để xuất');
      downloadJSON({ ...c.res.report, scan_id: c.res.scanId, label: c.res.label ?? null, simulated_profile: c.profile?.id, raw_probe_payload: c.raw }, `sentinelfp-${c.res.scanId}.json`);
    },
  };

  return (
    <div className="min-h-screen">
      <TopNav
        view={view}
        onView={setView}
        ruleset={meta.ruleset}
        profiles={meta.profiles}
        mockProfile={MOCK_PROFILE}
        actions={actions}
        busy={session.phase === 'scanning'}
      />
      <main className="mx-auto max-w-dashboard px-6 pb-20 pt-10">
        {view === 'scanner' && <ScannerView session={session} serverInfo={meta.serverInfo} />}
        {view === 'qa' && (
          <QAView session={session} qaLabel={qaLabel} setQaLabel={setQaLabel} onScanWithLabel={() => actions.rescan()} />
        )}
        {view === 'admin' && <AdminView />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
