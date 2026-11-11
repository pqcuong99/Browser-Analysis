import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createSelfSignedCert } from '../server/cert.ts';
import { difficultyFor, issuePow, leadingZeroBits, verifyPow } from '../server/pow.ts';
import { parseClientHello } from '../server/tlsfp.ts';
import { X509Certificate } from 'node:crypto';

// Chạy mã Worker của public/pow.js trong Node để chắc SHA-256 thuần JS khớp server
function loadWorker() {
  const src = readFileSync(new URL('../public/pow.js', import.meta.url), 'utf8');
  const worker = src.match(/const WORKER_SRC = `([\s\S]*?)`;/)![1];
  const posted: any[] = [];
  const self: any = { postMessage: (m: any) => posted.push(m) };
  new Function('self', 'performance', 'TextEncoder', worker)(self, performance, TextEncoder);
  return (prefix: string, difficulty: number) => {
    posted.length = 0;
    self.onmessage({ data: { prefix, difficulty } });
    return posted.find((m) => m.done);
  };
}

test('PoW: lời giải của Worker được server chấp nhận, dùng 1 lần', () => {
  const solve = loadWorker();
  const ch = issuePow('scan-1', '127.0.0.1', 'uaH', 14);
  const r = solve(ch.prefix, ch.difficulty);
  const digest = createHash('sha256').update(`${ch.prefix}:${r.nonce}`).digest();
  assert.ok(leadingZeroBits(digest) >= 14);
  const v = verifyPow(ch.id, r.nonce, '127.0.0.1', 'uaH');
  assert.equal(v.ok, true);
  assert.equal((v as any).sid, 'scan-1');
  assert.equal((v as any).difficulty, 14);
});

test('PoW: sai lời giải, sai ngữ cảnh, phát lại đều bị từ chối', () => {
  const solve = loadWorker();
  const a = issuePow('s', '1.1.1.1', 'u', 12);
  assert.equal((verifyPow(a.id, 'zzzz-not-a-solution', '1.1.1.1', 'u') as any).ok, false);
  const b = issuePow('s', '1.1.1.1', 'u', 12);
  const r = solve(b.prefix, b.difficulty);
  assert.equal((verifyPow(b.id, r.nonce, '2.2.2.2', 'u') as any).reason, 'context_mismatch');
  const c = issuePow('s', '1.1.1.1', 'u', 12);
  const rc = solve(c.prefix, c.difficulty);
  assert.equal(verifyPow(c.id, rc.nonce, '1.1.1.1', 'u').ok, true);
  assert.equal((verifyPow(c.id, rc.nonce, '1.1.1.1', 'u') as any).reason, 'unknown_or_used_challenge');
});

test('PoW: độ khó tăng khi Trust Score giảm', () => {
  const t = { safe: 80, suspicious: 50 };
  assert.equal(difficultyFor(79, t), 16);
  assert.equal(difficultyFor(50, t), 20);
  assert.ok(difficultyFor(65, t) > 16 && difficultyFor(65, t) < 20);
});

test('Chứng chỉ tự ký hợp lệ cho localhost', () => {
  const c = createSelfSignedCert();
  const x = new X509Certificate(c.cert);
  assert.match(x.subjectAltName ?? '', /DNS:localhost/);
  assert.match(x.subjectAltName ?? '', /IP Address:127\.0\.0\.1/);
  assert.ok(x.verify(x.publicKey));
});

test('parseClientHello tính JA4 đúng cấu trúc', () => {
  // ClientHello tối giản: 2 cipher (1 GREASE), ext SNI + ALPN h2 + supported_versions TLS1.3 + sig algs
  const ext = (type: number, data: Buffer) => Buffer.concat([Buffer.from([type >> 8, type & 255, data.length >> 8, data.length & 255]), data]);
  const sni = ext(0x0000, Buffer.from([0, 12, 0, 0, 9, ...Buffer.from('localhost')]));
  const alpn = ext(0x0010, Buffer.from([0, 3, 2, ...Buffer.from('h2')]));
  const sv = ext(0x002b, Buffer.from([4, 0x0a, 0x0a, 0x03, 0x04]));
  const sig = ext(0x000d, Buffer.from([0, 4, 0x04, 0x03, 0x08, 0x04]));
  const exts = Buffer.concat([sni, alpn, sv, sig]);
  const body = Buffer.concat([
    Buffer.from([0x03, 0x03]), Buffer.alloc(32), Buffer.from([0]),
    Buffer.from([0, 4, 0x0a, 0x0a, 0x13, 0x01]), Buffer.from([1, 0]),
    Buffer.from([exts.length >> 8, exts.length & 255]), exts,
  ]);
  const hs = Buffer.concat([Buffer.from([1, 0, body.length >> 8, body.length & 255]), body]);
  const rec = Buffer.concat([Buffer.from([0x16, 0x03, 0x01, hs.length >> 8, hs.length & 255]), hs]);
  const info = parseClientHello(rec)!;
  assert.equal(info.sni, 'localhost');
  assert.deepEqual(info.alpn, ['h2']);
  assert.match(info.ja4, /^t13d0104h2_[0-9a-f]{12}_[0-9a-f]{12}$/);
  assert.equal(info.ja4_r, 't13d0104h2_1301_000d,002b_0403,0804');
});
