// Bundles the gated HQ pages into the function, so they are only ever served after the server-side session check.
import fs from 'node:fs';
const read = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const out = 'export const APP_HTML = ' + JSON.stringify(read('app.html')) + ';\nexport const LOGIN_HTML = ' + JSON.stringify(read('login.html')) + ';\n';
fs.writeFileSync(new URL('../netlify/functions/lib/hq-html.mjs', import.meta.url), out);
console.log('hq pages bundled');
