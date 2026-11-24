// Scheduled run (production deploys only): reminders, waitlist offers that lapsed, thank-you notes, and the daily backup.
import { store, setDeployContext, storeName, flushDirty } from './lib/store.mjs';
import { dailyBackup } from './lib/backup.mjs';
import { sweep } from './lib/tickets.mjs';
import { migrate } from './lib/migrations.mjs';
import { runSchedule } from './lib/guestflow.mjs';
import { SITE_URL } from './lib/model.mjs';

export default async (req, ctx) => {
  setDeployContext((ctx && ctx.deploy && ctx.deploy.context) || process.env.CONTEXT);
  const s = await store(); await migrate(s, storeName());
  try { console.log('automation', JSON.stringify(await runSchedule(s, SITE_URL()))); } catch (err) { console.error('automation', err); }
  try { console.log('baskets', JSON.stringify(await sweep(s, '', { reconcile: true }))); } catch (err) { console.error('sweep', err); }
  await flushDirty();
  try { console.log('backup', JSON.stringify(await dailyBackup())); } catch (err) { console.error('backup', err); } // a failed backup never stops the guest messages
  return new Response('ok');
};
export const config = { schedule: '*/15 * * * *' };
