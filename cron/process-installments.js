const mongoose = require('mongoose');
const { Unit } = require('@unit-finance/unit-node-sdk');
require('dotenv').config();
const ShopifyMerchant = require('../models/ShopifyMerchant');
const SavingsGoal = require('../models/SavingsGoal');
const CheckoutCart = require('../models/CheckoutCart');
const { nodeAdapterInitialized } = require('@shopify/shopify-api/adapters/node');
const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');

if (!nodeAdapterInitialized) {
  throw new Error('Failed to initialize Node.js adapter');
}

const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGO_URI, { });
}

function todayPartsUTC(date = null) {
  const now = date ? new Date(date) : new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dateObj = new Date(Date.UTC(y, m, d));
  const dayOfMonth = dateObj.getUTCDate();
  const daysOfWeek = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dayOfWeek = daysOfWeek[dateObj.getUTCDay()];
  return { dayOfMonth, dayOfWeek };
}

async function processScheduledPayments(date = null) {
  await connectDB();
  const { dayOfMonth, dayOfWeek } = todayPartsUTC(date);

  console.log(`Finding savings goals for ${dayOfMonth} ${dayOfWeek}`);

  const savingsGoals = await SavingsGoal.find({
    "product.type": "Shopify",
    $or: [
      { "schedule.dayOfMonth": dayOfMonth },
      { "schedule.dayOfWeek": dayOfWeek }
    ]
  }).sort({ _id: 1 });

  console.log(`Processing ${savingsGoals.length} savings goals`);

  for (const goal of savingsGoals) {
    try {
      if (goal.isPaused) {
        console.log(`Skipping paused savings goal: ${goal.goalName}`);
        continue;
      }

      const { savingsAmount, plaidToken, userId } = goal;

      const merchant = await ShopifyMerchant.findOne({ shopifyShopId: "stashpay-2" });

      const achPaymentRequest = {
        type: 'achPayment',
        attributes: {
          amount: parseFloat(savingsAmount) * 100,
          direction: 'Debit',
          description: 'Funding',
          plaidProcessorToken: plaidToken,
          tags: { savingsGoalId: goal._id, userId: userId }
        },
        relationships: {
          account: { data: { type: 'account', id: merchant.unitAccountId } }
        }
      };

      const achPayment = await unit.payments.create(achPaymentRequest);

      goal.transfers.push({
        transferId: achPayment.data.id,
        amount: parseFloat(savingsAmount),
        date: new Date(),
        status: 'pending',
        type: 'debit'
      });

      goal.currentAmount += parseFloat(savingsAmount);

      await goal.save();

      console.log(`Created payment for ${goal.goalName}`);

      if (goal.currentAmount >= goal.targetAmount) {
        console.log(`Goal ${goal.goalName} has reached its target amount`);
        goal.isPaused = true;
        goal.savingsAmount = 0;
        await goal.save();

        await createOrder(goal);
      }
    } catch (err) {
      console.log(err);
      console.error('Cron payment error:', err?.message || err);
    }
  }
}

async function createOrder(goal) {
  const checkoutId = goal?.product?.checkoutId;
  if (!checkoutId) {
    throw new Error('Missing product.checkoutId on goal');
  }
  
  const cart = await CheckoutCart.findOne({checkoutId: checkoutId});

  if (!cart) {
    throw new Error('Checkout cart not found');
  }

  if (!cart.customerId) {
    throw new Error(`CheckoutCart ${checkoutId} has no customerId - this might be a guest checkout`);
  }

  const shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_CLIENT_ID,
    apiSecretKey: process.env.SHOPIFY_CLIENT_SECRET,
    scopes: ['write_orders', 'read_customers'],
    hostName: 'ngrok-tunnel-address',
    apiVersion: ApiVersion.July25,
    isTesting: true
  });

  const { session } = await shopify.auth.clientCredentials({shop: goal.product.shopDomain});

  const client = new shopify.clients.Graphql({ session, apiVersion: ApiVersion.July25});

  // TODO: Add shipping address to the order
  const mutation = `#graphql
    mutation orderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        userErrors {
          field
          message
        }
        order {
          id
          displayFinancialStatus
          customer {
            id
          }
        }
      }
    }
  `;

  const lineItems = goal.product.lineItems.map(item => ({
    variantId: `gid://shopify/ProductVariant/${item.variantId}`,
    quantity: item.quantity
  }));

  const variables = {
    order: {
      lineItems: lineItems,
      customer: {
        toAssociate: {
          id: `gid://shopify/Customer/${cart.customerId}`
        }
      },
      financialStatus: "PAID"
    }
  }
  console.log(JSON.stringify(variables, null, 2));
  
  const response = await client.request(mutation, { variables });

  console.log('Order creation response:', JSON.stringify(response, null, 2));

  if (response.data?.orderCreate?.userErrors?.length > 0) {
    console.error('Order creation errors:', response.data.orderCreate.userErrors);
    throw new Error(`Order creation failed: ${response.data.orderCreate.userErrors.map(e => e.message).join(', ')}`);
  }
  
  console.log('Order created successfully:', response.data?.orderCreate?.order?.id);
}

module.exports = { processScheduledPayments };
