const { Buffer } = require('node:buffer');
const { OAuth2Client } = require('google-auth-library');
const CheckoutCart = require('../models/CheckoutCart');
const oauthClient = new OAuth2Client();


module.exports = async function shopifyPubsub(req, res) {
  try {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString('utf8'));
      } catch (e) {
        console.error('Failed to parse raw Pub/Sub body buffer:', e.message);
        return res.status(400).json({ error: 'Invalid Pub/Sub payload' });
      }
    }

    const authorizationHeader = req.headers['authorization'];
    const jwtAudience = "https://api-sandbox.gostashpay.com/api/webhooks/shopify-pubsub";
    const expectedServiceAccount = process.env.PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL;

    if (authorizationHeader && authorizationHeader.startsWith('Bearer ')) {
      try {
        const idToken = authorizationHeader.split(' ')[1];
        const ticket = await oauthClient.verifyIdToken({ idToken, audience: jwtAudience });
        const claim = ticket.getPayload();

        if (expectedServiceAccount && claim.email !== expectedServiceAccount) {
          console.warn('Pub/Sub JWT email mismatch', { claimEmail: claim.email, expectedServiceAccount });
          return res.status(401).json({ error: 'Unauthorized' });
        }
        if (claim.iss !== 'https://accounts.google.com' && claim.iss !== 'accounts.google.com') {
          console.warn('Pub/Sub JWT issuer mismatch', { iss: claim.iss });
          return res.status(401).json({ error: 'Unauthorized' });
        }
      } catch (e) {
        console.error('Pub/Sub JWT verification failed:', e.message);
        return res.status(400).send('Invalid token');
      }
    } else {
      const configuredToken = process.env.PUBSUB_VERIFICATION_TOKEN;
      const headerToken = req.headers['x-pubsub-token'];
      const attrToken = body?.message?.attributes?.token;
      if (configuredToken) {
        if (!(headerToken && headerToken === configuredToken) && !(attrToken && attrToken === configuredToken)) {
          console.warn('Pub/Sub push rejected due to missing/invalid shared token');
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
    }

    const pushMessage = body?.message;
    console.log(body);
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
      payload = decoded;
    }

    console.log('Received Pub/Sub push:', {
      messageId: pushMessage.messageId,
      attributes,
      subscription: body.subscription,
      isJson: typeof payload === 'object'
    });

    await handleShopifyFromPubSub(pushMessage);

    return res.status(204).send();
  } catch (err) {
    console.error('Pub/Sub push handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleShopifyFromPubSub(pushMessage) {
  const attrs = pushMessage.attributes || {};
  const rawBody = Buffer.from(pushMessage.data, 'base64').toString('utf8');

  const payload = JSON.parse(rawBody);

  const eventId = attrs['X-Shopify-Event-Id'] || attrs['X-Shopify-Webhook-Id'];
  const topic = attrs['X-Shopify-Topic'];
  const shop = attrs['X-Shopify-Shop-Domain'];

  console.log('Shopify webhook:', { topic, shop, eventId });

  switch (topic) {
    case 'checkouts/create':
      await handleCheckoutCreate(payload, attrs);
      break;
    case 'orders/create':
      await handleOrderCreate(payload, attrs);
      break;
    default:
      console.log('Unhandled Shopify topic:', topic);
      break;
  }
}

async function handleCheckoutCreate(payload, attrs) {
  if (!payload.email){
    console.log('Skipping checkout create - no email provided');
    return;
  }

  try {
    const checkoutData = {
      checkoutId: payload.id.toString(),
      email: payload.email,
      shopDomain: attrs['X-Shopify-Shop-Domain'],
      lineItems: payload.line_items?.map(item => ({
        productId: item.product_id?.toString(),
        variantId: item.variant_id?.toString(),
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        vendor: item.vendor
      })) || [],
    };

    const existingCheckout = await CheckoutCart.findOne({ checkoutId: checkoutData.checkoutId });
    
    if (existingCheckout) {
      console.log('Checkout already exists, updating:', checkoutData.checkoutId);
      await CheckoutCart.findOneAndUpdate(
        { checkoutId: checkoutData.checkoutId },
        { ...checkoutData, updatedAt: new Date() },
        { new: true }
      );
    } else {
      const checkout = new CheckoutCart(checkoutData);
      await checkout.save();
      console.log('New checkout saved:', checkoutData.checkoutId);
    }

    console.log('Checkout processed:', {
      checkoutId: checkoutData.checkoutId,
      email: checkoutData.email
    });

  } catch (error) {
    console.error('Error handling checkout create:', error);
    throw error;
  }
}

async function handleOrderCreate(payload, attrs) {
  try {
    const checkoutId = payload.checkout_id;
    if (!checkoutId) {
      console.log('No checkout token found in order');
      return;
    }

    const checkout = await CheckoutCart.findOneAndUpdate(
      { checkoutId: checkoutId },
      { 
        status: 'completed',
        orderId: payload.id?.toString(),
        updatedAt: new Date()
      },
      { new: true }
    );

    if (checkout) {
      console.log('Checkout marked as completed:', {
        checkoutId: checkout.checkoutId,
        orderId: payload.id,
        email: checkout.email
      });
    } else {
      console.log('No checkout found for order token:', checkoutId);
    }

  } catch (error) {
    console.error('Error handling order create:', error);
    throw error;
  }
}
