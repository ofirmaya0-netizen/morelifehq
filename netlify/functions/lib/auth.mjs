// HQ access: the owner is defined entirely by server environment variables; team members sign in with their own password.
import crypto from 'node:crypto';

const COOKIE = 'hq_s';
const TTL = 12 * 60 * 60; // seconds

export function missingConfig() {
  return ['HQ_ADMIN_EMAIL', 'HQ_ADMIN_PASSWORD'].filter((k) => !process.env[k]);
}

// Cookie signing key. HQ_SESSION_SECRET (32+ chars) wins when set; otherwise a random key is generated once
// and kept in the server-side store. It is never sent to a browser or returned by any API.
let secret = null;
export async function initSecret(s) {
  if (secret) return;
  const env = process.env.HQ_SESSION_SECRET;
  if (env && env.length >= 32) { secret = env; return; }
  let rec = await s.get('config/sessionSecret');
  if (!rec || !rec.v) { rec = { v: crypto.randomBytes(48).toString('base64url'), at: new Date().toISOString() }; await s.set('config/sessionSecret', rec); rec = (await s.get('config/sessionSecret')) || rec; }
  secret = rec.v;
}

const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
const same = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

const ownerEmail = () => process.env.HQ_ADMIN_EMAIL.trim().toLowerCase();
// The owner is defined by the environment variables; team members are records in the store (see team.mjs).
export function checkLogin(email, password) {
  const okE = same(String(email || '').trim().toLowerCase(), ownerEmail());
  const okP = same(password || '', process.env.HQ_ADMIN_PASSWORD);
  return okE && okP;
}

// Team passwords: scrypt with a per-user salt. Only the salt and the derived key are stored.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  return { salt, key: crypto.scryptSync(String(password), salt, 64).toString('base64url') };
}
export function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.key) { crypto.scryptSync(String(password || ''), 'x', 64); return false; } // same work whether or not the account exists
  return same(crypto.scryptSync(String(password || ''), rec.salt, 64).toString('base64url'), rec.key);
}

// user: { id: 'owner' } or a team member { id, email, sv }. `sv` is the member's session version: raising it signs them out everywhere.
export function sessionCookie(req, user) {
  const u = user && user.id !== 'owner' ? { e: user.email, u: user.id, v: user.sv || 0 } : { e: ownerEmail(), u: 'owner' };
  const body = Buffer.from(JSON.stringify({ ...u, x: Math.floor(Date.now() / 1000) + TTL })).toString('base64url');
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL}${secure}`;
}

export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

// Checks the signature and expiry only. Whether a team member is still active is decided by team.mjs → currentUser().
export function session(req) {
  if (missingConfig().length || !secret) return null;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)hq_s=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig || !same(sig, sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.x < Date.now() / 1000) return null;
    const uid = p.u || 'owner';
    if (uid === 'owner' && p.e !== ownerEmail()) return null; // changing the env var revokes old sessions
    return { email: p.e, uid, v: p.v || 0 };
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
