const express = require('express');
const router = express.Router();
const { processScheduledPayments } = require('../cron/process-scheduled-payments');
const { processAbandonedCarts } = require('../cron/abandoned-carts');
const { sendPaymentReminders } = require('../cron/send-payment-reminders');

/**
 * Middleware to verify cron secret
 */
function requireCronSecret(req, res, next) {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Process scheduled payments cron endpoint
router.get('/process-payments', requireCronSecret, async (req, res) => {
  try {
    console.log('Cron job started at:', new Date().toISOString());
    await processScheduledPayments();
    console.log('Cron job completed at:', new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('Cron route error:', e);
    res.status(500).json({ error: 'Cron failed' });
  }
});

// Process abandoned carts cron endpoint
router.get('/abandoned-carts', requireCronSecret, async (req, res) => {
  try {
    console.log('Abandoned carts cron job started at:', new Date().toISOString());
    await processAbandonedCarts();
    console.log('Abandoned carts cron job completed at:', new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('Abandoned carts cron route error:', e);
    res.status(500).json({ error: 'Abandoned carts cron failed' });
  }
});

// Send payment reminder emails cron endpoint
router.get('/send-payment-reminders', requireCronSecret, async (req, res) => {
  try {
    console.log('Payment reminders cron job started at:', new Date().toISOString());
    await sendPaymentReminders();
    console.log('Payment reminders cron job completed at:', new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    console.error('Payment reminders cron route error:', e);
    res.status(500).json({ error: 'Payment reminders cron failed' });
  }
});

module.exports = router;

