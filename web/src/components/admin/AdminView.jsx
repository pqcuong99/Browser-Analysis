import { useCallback, useEffect, useState } from 'react';
import { Eye, KeyRound, ListChecks, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import { api, setAdminKey } from '../../lib/api.js';
import { cn } from '../../lib/cn.js';
import { Button } from '../common/Button.jsx';
import { Card, CardTitle, SectionHeader, TABLE } from '../common/Card.jsx';
import { StatusBadge } from '../common/StatusPill.jsx';
import { useToast } from '../common/Toast.jsx';
import { BlocklistCard, ScoringPolicyCard, ThresholdCard } from './PolicyCards.jsx';
import { RuleWeightsTable } from './RuleWeightsTable.jsx';

const ACTION_TO_STATUS = { ALLOW: 'PASS', CHALLENGE: 'WARNING', BLOCK: 'FAIL' };
const strip = (p) => ({ ...p, updatedAt: undefined });

function AdminKeyPrompt({ onSubmit }) {
  const [key, setKey] = useState('');
  return (
    <Card className="mx-auto mt-16 max-w-lg space-y-4">
      <CardTitle icon={KeyRound}>Cần quyền admin</CardTitle>
      <p className="text-sm text-ink-muted">Server có đặt ADMIN_KEY. Nhập key để quản lý policy (chỉ lưu trong sessionStorage của tab này). Khi không đặt ADMIN_KEY, chỉ truy cập từ localhost mới có quyền.</p>
      <div className="flex gap-3">
        <input type="password" autoComplete="off" className="field-input flex-1" placeholder="ADMIN_KEY" aria-label="Admin key" value={key} onChange={(e) => setKey(e.target.value)} />
        <Button variant="primary" onClick={() => onSubmit(key)}>Tiếp tục</Button>
      </div>
    </Card>
  );
}

function ImpactPreview({ rows }) {
  const changed = rows.filter((r) => r.before[1] !== r.after[1]).length;
  return (
    <section>
      <SectionHeader icon={Eye} title="Impact Preview" hint={`${rows.length} scan · ${changed} đổi quyết định`} />
      <div className={cn(TABLE.wrap, 'max-h-table-lg')}>
        <table className={TABLE.table}>
          <thead><tr>{['Scan / profile', 'Trust hiện tại', '', 'Trust (policy nháp)', ''].map((h, i) => <th key={i} className={TABLE.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn(r.before[1] !== r.after[1] && 'bg-warn-500/5')}>
                <td className={TABLE.td}><div className="text-ink">{r.label || '—'}</div><div className="font-mono text-xxs text-ink-faint">{r.id}</div></td>
                <td className={cn(TABLE.td, TABLE.num)}>{r.before[0] ?? '—'}</td>
                <td className={TABLE.td}>{r.before[1] && <StatusBadge status={ACTION_TO_STATUS[r.before[1]]} label={r.before[1]} />}</td>
                <td className={cn(TABLE.td, TABLE.num)}>{r.after[0]}</td>
                <td className={TABLE.td}><StatusBadge status={ACTION_TO_STATUS[r.after[1]]} label={r.after[1]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Chế độ Admin Rules & Blocking Policy */
export function AdminView() {
  const notify = useToast();
  const [state, setState] = useState({ phase: 'loading' });
  const [draft, setDraft] = useState(null);
  const [impact, setImpact] = useState(null);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const [meta, saved] = await Promise.all([api('/api/rules'), api('/api/policy')]);
      setState({ phase: 'ready', meta, saved });
      setDraft(structuredClone(saved.policy));
      setImpact(null);
    } catch (e) {
      setState({ phase: e.status === 403 ? 'auth' : 'error', error: e.message });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /** Sửa draft bằng hàm mutate trên bản sao */
  const update = useCallback((mutate) => setDraft((d) => { const n = structuredClone(d); mutate(n); return n; }), []);
  const setRule = useCallback((meta, key, value) => update((d) => {
    const next = { ...(d.rules[meta.id] || {}) };
    if (key === 'enabled') {
      if (value) delete next.enabled; else next.enabled = false;
    } else if (value === meta[key]) delete next[key];
    else next[key] = value;
    if (Object.keys(next).length) d.rules[meta.id] = next; else delete d.rules[meta.id];
  }), [update]);

  if (state.phase === 'loading') return <div className="mx-auto mt-24 h-10 w-10 animate-spin rounded-full border-4 border-zinc-800 border-t-accent-400" role="status" aria-label="Đang tải" />;
  if (state.phase === 'auth') return <AdminKeyPrompt onSubmit={(k) => { setAdminKey(k); load(); }} />;
  if (state.phase === 'error') return <p className="mt-16 text-center text-fail-300">Không tải được policy: {state.error}</p>;

  const { meta, saved } = state;
  const dirty = JSON.stringify(strip(draft)) !== JSON.stringify(strip(saved.policy));
  const savedAt = saved.policy.updatedAt ? ` lúc ${new Date(saved.policy.updatedAt).toLocaleString()}` : ' (mặc định)';

  const save = async () => {
    try {
      await api('/api/policy', { method: 'PUT', body: draft });
      notify('Đã lưu Blocking Policy. Các lần quét tiếp theo dùng policy mới.');
      load();
    } catch (e) { notify(`Lưu thất bại: ${e.message}`, 4000); }
  };
  const reset = async () => {
    if (!confirm('Khôi phục toàn bộ trọng số, ngưỡng và blocklist về mặc định?')) return;
    try { await api('/api/policy', { method: 'DELETE' }); notify('Đã khôi phục mặc định'); load(); } catch (e) { notify(`Thất bại: ${e.message}`, 4000); }
  };
  const preview = async () => {
    try { setImpact((await api('/api/policy/preview', { method: 'POST', body: draft })).rows); } catch (e) { notify(`Không chạy được preview: ${e.message}`, 4000); }
  };

  return (
    <div className="animate-fade-in pb-4">
      <SectionHeader icon={SlidersHorizontal} title="Admin Rules & Blocking Policy" hint={`Ruleset ${meta.version} · ${meta.rules.length} rule · server mode: ${saved.mode}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ThresholdCard draft={draft} defaults={saved.defaults} update={update} />
        <ScoringPolicyCard draft={draft} update={update} />
        <BlocklistCard draft={draft} update={update} />
      </div>
      <SectionHeader icon={ListChecks} title="Rule Weights & Confidence" hint="sᵢ = wᵢ × cᵢ · dòng tô màu là rule đã chỉnh khác mặc định" />
      <RuleWeightsTable meta={meta} draft={draft} setRule={setRule} />
      {impact && <ImpactPreview rows={impact} />}

      <div className="sticky bottom-4 mt-8 flex flex-wrap items-center gap-3 rounded-2xl bg-zinc-900/80 px-5 py-3.5 ring-1 ring-line-strong shadow-glass backdrop-blur-glass">
        <span className={cn('flex-1 text-xs', dirty ? 'font-semibold text-warn-300' : 'text-ink-faint')}>
          {dirty ? 'Có thay đổi chưa lưu' : `Đã lưu${savedAt}`}
        </span>
        <Button icon={Eye} onClick={preview}>Preview impact</Button>
        <Button variant="ghost" onClick={load}>Discard</Button>
        <Button variant="ghost" icon={RotateCcw} onClick={reset}>Reset defaults</Button>
        <Button variant="primary" icon={Save} onClick={save} disabled={!dirty}>Save policy</Button>
      </div>
    </div>
  );
}
