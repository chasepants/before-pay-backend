const express = require('express');
const router = express.Router();
const { webhook } = require('../webhooks/index');
const shopifyPubsub = require('../webhooks/shopifyPubsub');

router.post('/unit', async (req, res) => {
  try {
    await webhook(req, res);
  } catch (error) {
    console.error('Webhook invocation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/shopify-pubsub', async (req, res) => {
  try {
    await shopifyPubsub(req, res);
  } catch (error) {
    console.error('Pub/Sub route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

