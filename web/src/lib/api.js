/** fetch JSON từ backend, gắn x-admin-key nếu admin đã nhập */
export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let key = null;
  try { key = sessionStorage.getItem('sfp_admin_key'); } catch {}
  if (key) headers['x-admin-key'] = key;
  let body = opts.body;
  if (body && typeof body !== 'string') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { ...opts, body, headers, cache: 'no-store', credentials: 'include' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.message || json.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

export function setAdminKey(key) {
  try { sessionStorage.setItem('sfp_admin_key', key); } catch {}
}
