// Local stand-in for Netlify: serves ./site and routes /hq and /api/* to the function. Storage goes to ./.data
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
if (process.env.HQ_BLOBS_TEST) {
  // Exercise the real @netlify/blobs client against its local server instead of the file store
  const { BlobsServer } = await import('@netlify/blobs/server');
  const dir = path.resolve('.data-blobs'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const srv = new BlobsServer({ directory: dir, token: 'local', port: 8971 }); await srv.start();
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: 'http://localhost:8971', uncachedEdgeURL: 'http://localhost:8971', apiURL: 'http://localhost:8971', token: 'local', siteID: 'local-site', deployID: 'local' })).toString('base64');
} else process.env.HQ_LOCAL_STORE ||= path.resolve('.data');
const { default: handler } = await import('../netlify/functions/api.mjs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const port = +process.env.PORT || 8888;
http.createServer(async (rq, rs) => {
  const url = new URL(rq.url, 'http://localhost:' + port);
  if (/^\/(hq|api\/(hq|public)|events|invite|door|pay|api\/door|sitemap\.xml|robots\.txt)(\/|$)/.test(url.pathname) || url.pathname === '/') {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const req = new Request(url, { method: rq.method, headers: rq.headers, body: ['GET', 'HEAD'].includes(rq.method) ? undefined : Buffer.concat(chunks) });
    const res = await handler(req, { ip: '127.0.0.1' });
    const h = {}; res.headers.forEach((v, k) => { h[k] = v; });
    rs.writeHead(res.status, h); rs.end(Buffer.from(await res.arrayBuffer())); return;
  }
  let p = path.join('site', decodeURIComponent(url.pathname)); if (url.pathname.endsWith('/')) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); rs.end('not found'); return; }
  rs.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(rs);
}).listen(port, () => console.log('http://localhost:' + port));
