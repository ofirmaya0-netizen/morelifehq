// HQ access: one admin, defined entirely by server environment variables.
import crypto from 'node:crypto';

const COOKIE = 'hq_s';
const TTL = 12 * 60 * 60; // seconds

export function missingConfig() {
  return ['HQ_ADMIN_EMAIL', 'HQ_ADMIN_PASSWORD', 'HQ_SESSION_SECRET'].filter((k) => !process.env[k] || (k === 'HQ_SESSION_SECRET' && process.env[k].length < 32));
}

const sign = (data) => crypto.createHmac('sha256', process.env.HQ_SESSION_SECRET).update(data).digest('base64url');
const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

export function checkLogin(email, password) {
  const okE = same(String(email || '').trim().toLowerCase(), process.env.HQ_ADMIN_EMAIL.trim().toLowerCase());
  const okP = same(password || '', process.env.HQ_ADMIN_PASSWORD);
  return okE && okP;
}

export function sessionCookie(req) {
  const body = Buffer.from(JSON.stringify({ e: process.env.HQ_ADMIN_EMAIL.trim().toLowerCase(), x: Math.floor(Date.now() / 1000) + TTL })).toString('base64url');
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}${secure}`;
}

export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

export function session(req) {
  if (missingConfig().length) return null;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)hq_s=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !same(sig, sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.x < Date.now() / 1000) return null;
    if (p.e !== process.env.HQ_ADMIN_EMAIL.trim().toLowerCase()) return null; // changing the env var revokes old sessions
    return { email: p.e };
  } catch { return null; }
}

// State-changing requests must come from our own pages: same origin + a custom header a cross-site form cannot send.
export function sameOrigin(req) {
  const o = req.headers.get('origin');
  if (o && new URL(o).host !== new URL(req.url).host) return false;
  return req.headers.get('x-hq') === '1';
}

export const token = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
export const id = () => crypto.randomBytes(9).toString('base64url');
export const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
