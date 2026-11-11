import { useCallback, useRef, useState } from 'react';
import mockData from '../data/mockData.json';
import { api } from '../lib/api.js';
import { normalizeReport } from '../lib/report.js';

/**
 * Trạng thái phiên quét của Public Scanner.
 * current = { res: { scanId, mode, label, report, challenge, events }, raw, profile?, rescanOf?, prev? }
 */
export function useScanSession({ notify }) {
  const [phase, setPhase] = useState('idle'); // idle | scanning | ready | error
  const [steps, setSteps] = useState({ now: null, done: [] });
  const [current, setCurrentState] = useState(null);
  const [error, setError] = useState(null);
  const currentRef = useRef(null);
  const lastLiveRef = useRef(null);
  const busyRef = useRef(false);

  const commit = useCallback((next, { live }) => {
    const prev = currentRef.current;
    const entry = { ...next, res: { ...next.res, report: normalizeReport(next.res.report) }, prev: prev ?? undefined };
    // Re-scan: so với lần quét thật gần nhất
    if (live && lastLiveRef.current && lastLiveRef.current.res.scanId !== next.res.scanId) entry.rescanOf = lastLiveRef.current;
    if (live) lastLiveRef.current = entry;
    currentRef.current = entry;
    setCurrentState(entry);
    setPhase('ready');
    const url = new URL(location.href);
    url.searchParams.delete('mock');
    url.searchParams.set('scan', next.res.scanId);
    if (next.profile?.id === mockData.profile.id) {
      url.searchParams.delete('scan');
      url.searchParams.set('mock', '1');
    }
    history.replaceState(null, '', url);
  }, []);

  const fail = useCallback((e) => {
    setError(String(e?.message ?? e));
    setPhase('error');
  }, []);

  const scanLive = useCallback(async (label) => {
    if (busyRef.current) return;
    if (!window.SentinelFP) return fail(new Error('Không tải được /probe.js (backend chưa chạy?)'));
    busyRef.current = true;
    setPhase('scanning');
    setSteps({ now: null, done: [] });
    try {
      const res = await window.SentinelFP.verify({
        label: label || null,
        onStep: (s) => setSteps((st) => ({ now: s, done: st.now ? [...st.done, st.now] : st.done })),
      });
      const full = await api(`/api/scans/${res.scanId}`);
      commit({ res: { scanId: res.scanId, mode: res.mode, label: res.label, report: res.report, challenge: null }, raw: full.raw }, { live: true });
      if (label) notify(`Đã lưu scan với label "${label}"`);
    } catch (e) {
      fail(e);
    } finally {
      busyRef.current = false;
    }
  }, [commit, fail, notify]);

  const simulate = useCallback(async (id) => {
    setPhase('scanning');
    try {
      const s = await api(`/api/simulate/${encodeURIComponent(id)}`);
      commit({ res: { scanId: s.scanId, mode: s.mode, label: s.label, report: s.report }, raw: s.raw, profile: s.profile }, { live: false });
    } catch (e) {
      fail(e);
    }
  }, [commit, fail]);

  /** Dữ liệu tĩnh từ mockData.json (không cần backend) */
  const loadMock = useCallback(() => {
    commit({ res: { scanId: mockData.scanId, mode: mockData.mode, label: mockData.label, report: mockData.report }, raw: mockData.raw, profile: mockData.profile }, { live: false });
  }, [commit]);

  const loadScan = useCallback(async (id, profiles) => {
    setPhase('scanning');
    try {
      const s = await api(`/api/scans/${encodeURIComponent(id)}`);
      const profile = s.report.simulated_profile ? profiles?.find((p) => p.id === s.report.simulated_profile) : undefined;
      commit({ res: { scanId: s.scanId, mode: s.mode, label: s.label, report: s.report, challenge: s.challenge, events: s.events }, raw: s.raw, profile }, { live: !profile });
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        notify(e.message || 'Không tìm thấy scan, quét lại');
        busyRef.current = false;
        return scanLive();
      }
      fail(e);
    }
  }, [commit, fail, notify, scanLive]);

  const backToLive = useCallback(() => {
    if (lastLiveRef.current) {
      currentRef.current = lastLiveRef.current;
      setCurrentState(lastLiveRef.current);
      setPhase('ready');
      return;
    }
    scanLive();
  }, [scanLive]);

  const markChallengePassed = useCallback((challenge) => {
    const next = { ...currentRef.current, res: { ...currentRef.current.res, challenge } };
    currentRef.current = next;
    if (lastLiveRef.current?.res.scanId === next.res.scanId) lastLiveRef.current = next;
    setCurrentState(next);
    notify('Đã vượt CHALLENGE: phiên được cho qua nhưng bị gắn cờ và giới hạn tốc độ');
  }, [notify]);

  return { phase, steps, current, error, prev: current?.prev, scanLive, simulate, loadMock, loadScan, backToLive, markChallengePassed };
}

export const MOCK_PROFILE = mockData.profile;
