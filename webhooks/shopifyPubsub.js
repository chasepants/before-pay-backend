const { Buffer } = require('node:buffer');

// Google Pub/Sub push message format:
// {
//   message: {
//     data: base64String,
//     messageId: string,
//     attributes: { [key: string]: string }
//   },
//   subscription: string
// }

module.exports = async function shopifyPubsub(req, res) {
  try {
    // Optional shared-secret verification
    const configuredToken = process.env.PUBSUB_VERIFICATION_TOKEN;
    const headerToken = req.headers['x-pubsub-token'];
    const attrToken = req.body?.message?.attributes?.token;
    if (configuredToken) {
      if (!(headerToken && headerToken === configuredToken) && !(attrToken && attrToken === configuredToken)) {
        console.warn('Pub/Sub push rejected due to invalid verification token');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const pushMessage = req.body?.message;
    if (!pushMessage || !pushMessage.data) {
      console.error('Invalid Pub/Sub push: missing message/data');
      return res.status(400).json({ error: 'Invalid Pub/Sub payload' });
    }

    const attributes = pushMessage.attributes || {};
    const buffer = Buffer.from(pushMessage.data, 'base64');
    const decoded = buffer.toString();

    let payload;
    try {
      payload = JSON.parse(decoded);
    } catch (e) {
      payload = decoded; // fallback to raw string if not JSON
    }

    console.log('Received Pub/Sub push:', {
      messageId: pushMessage.messageId,
      attributes,
      subscription: req.body.subscription,
      isJson: typeof payload === 'object'
    });

    // At this point, route the payload to the appropriate handler as needed.
    // If Shopify is pushing into Pub/Sub, payload structure will be the original Shopify webhook payload.
    // You can branch on attributes (e.g., attributes.topic) to dispatch to specific logic.

    // For now we just acknowledge; add business logic/dispatch here as needed.
    return res.status(204).send(); // 2xx acknowledges delivery
  } catch (err) {
    console.error('Pub/Sub push handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


