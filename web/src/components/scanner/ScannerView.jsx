import { useCallback, useRef, useState } from 'react';
import { trustBand } from '../../lib/statusStyles.js';
import { useToast } from '../common/Toast.jsx';
import { BlockScreenModal } from './BlockScreenModal.jsx';
import { EvidenceDrawer } from './EvidenceDrawer.jsx';
import { ModuleGrid } from './ModuleGrid.jsx';
import { OverviewBanner } from './OverviewBanner.jsx';
import { RescanReport } from './RescanReport.jsx';
import { NetworkHint, ScanError, ScanProgress, SimBanner } from './ScannerExtras.jsx';
import { ScoringBreakdown } from './ScoringBreakdown.jsx';

// Thông báo kết quả sau khi gauge chạy xong, theo dải Trust Score
const COMPLETION_ALERTS = {
  safe: { tone: 'success', title: '✅ Hoàn tất: Trình duyệt an toàn hợp lệ' },
  suspicious: { tone: 'warning', title: '⚠️ Cảnh báo: Phát hiện bất thường - Đã lưu log' },
  high: { tone: 'danger', title: '⚠️ Cảnh báo: Phát hiện bất thường - Đã lưu log' },
};

function completionAlert(ctx) {
  const sb = ctx.res.report.scoring_breakdown;
  const band = trustBand(sb.trust_score, sb.thresholds);
  const alert = { ...COMPLETION_ALERTS[band] };
  const c = ctx.res.report.module_summary_counts;
  const detail = band === 'safe'
    ? `Trust Score ${sb.trust_score}/100 · ${sb.enforcement_action}`
    : `Trust Score ${sb.trust_score}/100 · ${sb.enforcement_action} · ${c.FAIL} FAIL, ${c.WARNING} WARNING · log ${ctx.res.scanId.slice(0, 8)}…`;
  // Dữ liệu mock tĩnh không được ghi vào DB, nên không nói là đã lưu log
  const isStaticMock = ctx.profile?.id?.startsWith('mock-');
  if (isStaticMock && band !== 'safe') {
    alert.title = '⚠️ Cảnh báo: Phát hiện bất thường';
    return { ...alert, message: `${detail.replace(/ · log .*$/, '')} · dữ liệu mock, không ghi log`, icon: false, duration: 6000 };
  }
  return { ...alert, message: detail, icon: false, duration: 6000 };
}

/** Chế độ Public Scanner */
export function ScannerView({ session, serverInfo }) {
  const notify = useToast();
  const { phase, current: ctx, steps, error } = session;
  const [openModule, setOpenModule] = useState(null);
  const [preview, setPreview] = useState(false);
  const alerted = useRef(null);
  const closeDrawer = useCallback(() => setOpenModule(null), []);
  const closePreview = useCallback(() => setPreview(false), []);

  // Gauge đếm xong (~1.5s) thì báo kết quả, mỗi scan chỉ báo một lần
  const onScoreAnimated = useCallback(() => {
    if (!ctx || alerted.current === ctx.res.scanId) return;
    alerted.current = ctx.res.scanId;
    notify(completionAlert(ctx));
  }, [ctx, notify]);

  if (phase === 'scanning') return <ScanProgress steps={steps} />;
  if (phase === 'error') return <ScanError message={error} onRetry={() => session.scanLive()} />;
  if (!ctx) return null;

  return (
    <div className="animate-fade-in">
      {ctx.profile && <SimBanner profile={ctx.profile} onBack={session.backToLive} />}
      <OverviewBanner
        ctx={ctx}
        onPreview={() => setPreview(true)}
        onOpenModule={setOpenModule}
        onChallengePassed={session.markChallengePassed}
        onScoreAnimated={onScoreAnimated}
      />
      {ctx.rescanOf && <RescanReport prev={ctx.rescanOf} ctx={ctx} />}
      <ModuleGrid modules={ctx.res.report.modules} onOpen={setOpenModule} animKey={ctx.res.scanId} />
      <NetworkHint ctx={ctx} serverInfo={serverInfo} />
      <ScoringBreakdown sb={ctx.res.report.scoring_breakdown} />
      {openModule && <EvidenceDrawer ctx={ctx} moduleId={openModule} onClose={closeDrawer} />}
      {preview && <BlockScreenModal ctx={ctx} onClose={closePreview} />}
    </div>
  );
}
