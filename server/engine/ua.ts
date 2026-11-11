export type Engine = 'blink' | 'gecko' | 'webkit' | 'unknown';
export type OS = 'Windows' | 'macOS' | 'Linux' | 'Android' | 'iOS' | 'ChromeOS' | 'Other';

export interface ParsedUA {
  raw: string;
  browser: string;
  version: string | null;
  major: number | null;
  os: OS;
  mobile: boolean;
  engine: Engine;
  chromeMajor: number | null;
  firefoxMajor: number | null;
  headless: boolean;
}

export function parseUA(ua = ''): ParsedUA {
  const r: ParsedUA = {
    raw: ua, browser: 'Other', version: null, major: null, os: 'Other', mobile: false,
    engine: 'unknown', chromeMajor: null, firefoxMajor: null, headless: /HeadlessChrome/.test(ua),
  };
  const m = (re: RegExp) => ua.match(re)?.[1] ?? null;

  if (/iPhone|iPad|iPod/.test(ua)) { r.os = 'iOS'; r.mobile = /iPhone|iPod|Mobile\//.test(ua); }
  else if (/Android/.test(ua)) { r.os = 'Android'; r.mobile = /Mobile/.test(ua); }
  else if (/CrOS/.test(ua)) r.os = 'ChromeOS';
  else if (/Windows NT/.test(ua)) r.os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) r.os = 'macOS';
  else if (/Linux|X11/.test(ua)) r.os = 'Linux';

  let v: string | null;
  if (r.os === 'iOS') {
    r.engine = 'webkit';
    if ((v = m(/CriOS\/([\d.]+)/))) r.browser = 'Chrome';
    else if ((v = m(/FxiOS\/([\d.]+)/))) r.browser = 'Firefox';
    else if ((v = m(/EdgiOS\/([\d.]+)/))) r.browser = 'Edge';
    else { v = m(/Version\/([\d.]+)/); r.browser = 'Safari'; }
    r.version = v;
  } else if ((v = m(/Firefox\/([\d.]+)/))) {
    r.browser = 'Firefox'; r.engine = 'gecko'; r.version = v;
    r.firefoxMajor = parseInt(v, 10);
  } else if ((v = m(/Edg(?:A|e)?\/([\d.]+)/))) {
    r.browser = 'Edge'; r.engine = 'blink'; r.version = v;
  } else if ((v = m(/OPR\/([\d.]+)/))) {
    r.browser = 'Opera'; r.engine = 'blink'; r.version = v;
  } else if ((v = m(/SamsungBrowser\/([\d.]+)/))) {
    r.browser = 'Samsung Internet'; r.engine = 'blink'; r.version = v;
  } else if ((v = m(/(?:Headless)?Chrome\/([\d.]+)/))) {
    r.browser = r.headless ? 'HeadlessChrome' : 'Chrome'; r.engine = 'blink'; r.version = v;
  } else if (/Safari\//.test(ua) && (v = m(/Version\/([\d.]+)/))) {
    r.browser = 'Safari'; r.engine = 'webkit'; r.version = v;
  }

  if (r.engine === 'blink') {
    const c = m(/Chrome\/(\d+)/);
    r.chromeMajor = c ? parseInt(c, 10) : null;
  }
  r.major = r.version ? parseInt(r.version, 10) : null;
  return r;
}

/** navigator.platform hợp lệ với OS khai báo trong UA */
export function platformMatchesOS(os: OS, platform: string): boolean {
  switch (os) {
    case 'Windows': return /^Win(32|64)$/.test(platform);
    case 'macOS': return /^Mac/.test(platform) || platform === 'iPad'; // iPad desktop mode
    case 'Linux': return /^Linux/.test(platform) || platform === '';
    case 'Android': return /^Linux|^Android/.test(platform) || platform === '';
    case 'ChromeOS': return /^Linux|CrOS/.test(platform);
    case 'iOS': return /^(iPhone|iPad|iPod)/.test(platform) || platform === 'MacIntel';
    default: return true;
  }
}

/** userAgentData.platform hợp lệ với OS khai báo */
export function chPlatformMatchesOS(os: OS, p: string): boolean {
  const map: Record<string, string[]> = {
    Windows: ['Windows'], macOS: ['macOS'], Linux: ['Linux'], Android: ['Android'],
    ChromeOS: ['Chrome OS', 'ChromeOS'],
  };
  const allowed = map[os];
  return !allowed || allowed.includes(p);
}

export function parseSecChUa(h: string | undefined): { brand: string; version: string }[] | null {
  if (!h) return null;
  const out: { brand: string; version: string }[] = [];
  const re = /"((?:[^"\\]|\\.)*)"\s*;\s*v\s*=\s*"([^"]*)"/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(h))) out.push({ brand: x[1], version: x[2] });
  return out;
}

const isGrease = (b: string) => /not.?a.?brand/i.test(b) || /[^\w\s.-]/.test(b.replace(/[()]/g, ''));

export function brandMajor(brands: { brand: string; version: string }[] | undefined, names: string[]): number | null {
  for (const n of names) {
    const b = brands?.find((x) => x.brand === n);
    if (b) return parseInt(b.version, 10);
  }
  return null;
}

export const realBrands = (brands: { brand: string }[] = []) => brands.map((b) => b.brand).filter((b) => !isGrease(b));
