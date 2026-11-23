// Scheduled run (production deploys only): reminders, waitlist offers that lapsed, thank-you notes.
import { store, setDeployContext, storeName } from './lib/store.mjs';
import { migrate } from './lib/migrations.mjs';
import { runSchedule } from './lib/guestflow.mjs';
import { SITE_URL } from './lib/model.mjs';

export default async (req, ctx) => {
  setDeployContext((ctx && ctx.deploy && ctx.deploy.context) || process.env.CONTEXT);
  const s = await store(); await migrate(s, storeName());
  console.log('automation', JSON.stringify(await runSchedule(s, SITE_URL())));
  return new Response('ok');
};
export const config = { schedule: '*/15 * * * *' };
