// Bundles into the function: (1) the gated HQ app (served only after the server-side session check),
// (2) the public home page, which the function serves with published content and SEO tags written into the first HTML response.
import fs from 'node:fs';
const root = new URL('../', import.meta.url), read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
const dir = new URL('src/hq/', root);
const js = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => '/* ' + f + ' */\n' + read('src/hq/' + f)).join('\n');
const app = read('src/hq/app.html').replace('/*CSS*/', () => read('src/hq/app.css')).replace('/*JS*/', () => js.replace(/<\/script/g, '<\\/script'));
fs.writeFileSync(new URL('netlify/functions/lib/hq-html.mjs', root), 'export const APP_HTML = ' + JSON.stringify(app) + ';\nexport const LOGIN_HTML = ' + JSON.stringify(read('src/login.html')) + ';\nexport const DOOR_HTML = ' + JSON.stringify(read('src/door.html')) + ';\n');
fs.writeFileSync(new URL('netlify/functions/lib/site-html.mjs', root), 'export const SITE_HTML = ' + JSON.stringify(read('site/index.html')) + ';\n');
console.log('bundled: hq app (' + Math.round(app.length / 1024) + ' kB), home page');
