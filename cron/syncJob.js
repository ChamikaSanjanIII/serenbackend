const cron = require('node-cron');
const { syncFromClipGo } = require('../controllers/clipgoSyncController');

const initCronJobs = () => {
  // Default: Every 6 hours ('0 */6 * * *')
  const cronExpression = process.env.CRON_SYNC_SCHEDULE || '0 */6 * * *';

  console.log(`[Cron] Initializing auto-sync job with schedule: "${cronExpression}"`);

  cron.schedule(cronExpression, async () => {
    console.log(`[Cron Trigger] Auto-synchronizing video collection from ClipGo API at ${new Date().toISOString()}`);
    try {
      await syncFromClipGo();
      console.log(`[Cron Trigger] Auto-sync finished successfully.`);
    } catch (err) {
      console.error(`[Cron Trigger] Auto-sync failed: ${err.message}`);
    }
  });
};

module.exports = initCronJobs;
