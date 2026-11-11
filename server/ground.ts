import { createHmac } from 'node:crypto';
import { config } from './config.ts';
import type { NetIntel } from './engine/types.ts';

/**
 * Đối chiếu với STUN/TURN trên VPS (vps/stun-listener.cjs).
 * Mỗi phiên quét có một tag suy ra từ nonce; tag nằm trong USERNAME của TURN Allocate nên VPS biết gói UDP
 * đến từ IP:port nào thuộc phiên nào, bất kể JavaScript báo candidate gì.
 */
export const groundTag = (nonce: string) =>
  createHmac('sha256', config.secret).update(`ground:${nonce}`).digest('base64url').slice(0, 22);

/** iceServers gửi kèm challenge cho probe (null khi chưa cấu hình) */
export function groundIceServers(nonce: string) {
  const g = config.ground;
  if (!g.enabled) return null;
  const username = `${Math.floor(Date.now() / 1000) + config.nonceTtlSec}:${groundTag(nonce)}`;
  // Mật khẩu theo chuẩn TURN REST API, VPS tự tính lại được từ GROUND_KEY để ký MESSAGE-INTEGRITY
  const credential = createHmac('sha1', g.key).update(username).digest('base64');
  const host = g.host.includes(':') && !g.host.startsWith('[') ? `[${g.host}]` : g.host;
  return [
    { urls: `stun:${host}:${g.stunPort}` },
    { urls: [`turn:${host}:${g.stunPort}?transport=udp`, `turn:${host}:${g.stunPort}?transport=tcp`], username, credential },
  ];
}

/** Hỏi VPS các nguồn đã thấy của phiên này (và các STUN Binding trùng port srflx) */
export async function groundLookup(nonce: string, ports: number[]): Promise<NetIntel['ground']> {
  const g = config.ground;
  if (!g.enabled) return undefined;
  try {
    const u = new URL('/lookup', g.api);
    u.searchParams.set('tag', groundTag(nonce));
    if (ports.length) u.searchParams.set('ports', ports.slice(0, 20).join(','));
    const r = await fetch(u, { headers: { 'x-ground-key': g.key }, signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { vps: g.host, error: `VPS trả HTTP ${r.status}` };
    const j = (await r.json()) as any;
    return { vps: g.host, sources: Array.isArray(j.sources) ? j.sources : [], bindings: Array.isArray(j.bindings) ? j.bindings : [] };
  } catch (e) {
    return { vps: g.host, error: String((e as Error)?.message ?? e) };
  }
}
