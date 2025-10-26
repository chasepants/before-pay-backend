const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const ShopifyMerchant = require('../models/ShopifyMerchant');
const { Unit } = require('@unit-finance/unit-node-sdk');
const axios = require('axios');
const CheckoutCart = require('../models/CheckoutCart');
const { nodeAdapterInitialized } = require('@shopify/shopify-api/adapters/node');
const { shopifyApi, ApiVersion } = require('@shopify/shopify-api');
if (!nodeAdapterInitialized) {
  throw new Error('Failed to initialize Node.js adapter');
}

let unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

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

function setUnitInstance(unitInstance) {
  unit = unitInstance;
}

async function approveTestUserApplication(applicationId) {
  console.log("approving test user application");
  response = await axios.post(
    `https://api.s.unit.sh/sandbox/applications/${applicationId}/approve`,
    {
      data: {
        type: "applicationApprove",
        attributes: {
            reason: "sandbox"
        }
      }
    },
    {
      headers: {
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Bearer ${process.env.UNIT_API_KEY}`,
        'X-Accept-Version': 'V2024_06'
      }
    }
  );
}

async function findGoalByPaymentId(paymentId) {
  if (!paymentId) return null;
  return SavingsGoal.findOne({ 'transfers.transferId': paymentId });
}

function setTransferStatus(goal, paymentId, status) {
  const idx = goal.transfers.findIndex(t => t.transferId === paymentId);
  if (idx === -1) return false;
  goal.transfers[idx].status = status;
  return true;
}

async function handlePaymentCreated(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  const goal = await findGoalByPaymentId(paymentId);
  if (!goal) return;
  if (!setTransferStatus(goal, paymentId, 'pending')) return;
  await goal.save();
  console.log(`payment.created → pending for transfer ${paymentId}`);
}

async function handlePaymentClearing(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  const goal = await findGoalByPaymentId(paymentId);
  if (!goal) return;
  if (!setTransferStatus(goal, paymentId, 'pending')) return;
  await goal.save();
  console.log(`payment.clearing → pending for transfer ${paymentId}`);
  if (goal.product && "Shopify" === goal.product?.type && goal.currentAmount >= goal.targetAmount) {
      console.log(`Goal ${goal.goalName} has reached its target amount`);
      goal.isPaused = true;
      goal.savingsAmount = 0;
      await goal.save();
      try {
        await createOrder(goal);
      } catch (error) {
        console.log(error)
      }
  }
}

async function handlePaymentSent(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  const goal = await findGoalByPaymentId(paymentId);
  if (!goal) return;
  if (!setTransferStatus(goal, paymentId, 'pending')) return;
  await goal.save();
  console.log(`payment.sent → pending for transfer ${paymentId}`);
}

async function handlePaymentRejected(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  const goal = await findGoalByPaymentId(paymentId);
  if (!goal) return;
  if (!setTransferStatus(goal, paymentId, 'failed')) return;
  await goal.save();
  console.log(`payment.rejected → failed for transfer ${paymentId}`);
}

async function handlePaymentReturned(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  const goal = await findGoalByPaymentId(paymentId);
  if (!goal) return;
  if (!setTransferStatus(goal, paymentId, 'failed')) return;
  await goal.save();
  console.log(`payment.returned → failed for transfer ${paymentId}`);
}

async function handlePaymentCanceled(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  const goal = await findGoalByPaymentId(paymentId);
  if (!goal) return;
  if (!setTransferStatus(goal, paymentId, 'canceled')) return;
  await goal.save();
  console.log(`payment.canceled → canceled for transfer ${paymentId}`);
}

async function handleTransactionCreated(eventData) {
  const tags = eventData.attributes?.tags || {};
  const kind = tags.kind;
  const transactionId = eventData.relationships?.transaction?.data?.id;
  
  console.log('Transaction created webhook:', { kind, transactionId });
  
  if (kind === 'transferBackBatch') {
    const batchId = tags.batchId;
    if (!batchId) return;

    const allGoals = await SavingsGoal.find({});
    const goalsWithBatch = allGoals.filter(g => g.transfers.some(t => t.batchId === batchId));
    console.log(`Total goals in DB: ${allGoals.length}`);
    console.log(`Goals with batchId ${batchId}: ${goalsWithBatch.length}`);
    goalsWithBatch.forEach(g => {
      console.log(`Goal ${g._id} (${g.goalName}) has ${g.transfers.filter(t => t.batchId === batchId).length} transfers with batchId ${batchId}`);
    });

    const goals = await SavingsGoal.find({ 'transfers.batchId': batchId });
    console.log(`Found ${goals.length} goals for batch ${batchId}`);

    const goalsAlt = await SavingsGoal.find({
      transfers: {
        $elemMatch: {
          batchId: batchId,
          type: 'credit',
          status: { $ne: 'completed' }
        }
      }
    });
    console.log(`Alternative query found ${goalsAlt.length} goals`);
    
    for (const goal of goals) {
      console.log(`Processing goal ${goal._id} (${goal.goalName})`);
      for (let i = 0; i < goal.transfers.length; i++) {
        const transfer = goal.transfers[i];
        if (!(transfer.batchId === batchId && transfer.type === 'credit' && transfer.status !== 'completed')) {
          console.log(`skipping ${transfer._id}`)
          continue;
        }

        console.log(`Updating transfer ${transfer._id} in goal ${goal._id}`);
        
        const update_transaction_id = await SavingsGoal.findOneAndUpdate(
          { 
            _id: goal._id,
            'transfers._id': transfer._id 
          },
          { 
            $set: { 
              'transfers.$.transactionId': transactionId,
            }
          },
          { new: true }
        );
        
        
        if (update_transaction_id) {
          console.log(`Successfully updated transfer ${transfer._id} transaction id in goal ${goal._id}`);
        } else {
          console.log(`Failed to update transfer ${transfer._id} transaction id in goal ${goal._id}`);
        }

        const update_status_and_current_amount = await SavingsGoal.findOneAndUpdate(
          { 
            _id: goal._id,
            'transfers._id': transfer._id 
          },
          { 
            $set: { 
              'transfers.$.status': 'completed',
            },
            $inc: { currentAmount: -transfer.amount }
          },
          { new: true }
        );

        if (update_status_and_current_amount) {
          console.log(`Successfully updated transfer ${transfer._id} status and goal amount in goal ${goal._id}`);
        } else {
          console.log(`Failed to update transfer ${transfer._id} status and goal amount in goal ${goal._id}`);
        }
      }
    }
    
    console.log(`transaction.created → completed batch ${batchId}, transactionId: ${transactionId}`);
    return;
  }

  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  
  const goal = await SavingsGoal.findOne({ 'transfers.transferId': paymentId });
  if (!goal) {
    console.log(`No goal found for payment ${paymentId}`);
    return;
  }
  
  const idx = goal.transfers.findIndex(t => t.transferId === paymentId);
  if (idx === -1) {
    console.log(`No transfer found for payment ${paymentId} in goal ${goal._id}`);
    return;
  }
  
  if (goal.transfers[idx].status !== 'completed') {
    console.log(`Updating transfer ${goal.transfers[idx]._id} in goal ${goal._id}`);
    goal.transfers[idx].status = 'completed';
    goal.transfers[idx].transactionId = transactionId;
    const amt = goal.transfers[idx].amount;
    if (goal.transfers[idx].type === 'debit') {
      goal.currentAmount += amt;
    } else if (goal.transfers[idx].type === 'credit') {
      goal.currentAmount = Math.max(0, (goal.currentAmount || 0) - amt);
    }
    await goal.save();
    console.log(`transaction.created → completed for transfer ${paymentId}, transactionId: ${transactionId}`);
  }
}

async function handleApplicationApproved(eventData) {
  const applicationId = eventData.relationships?.application?.data?.id;
  const user = applicationId ? await User.findOne({ unitApplicationId: applicationId }) : null;
  if (user) {
    user.status = 'approved';
    await user.save();
    console.log(`User ${user.email} application approved`);
  }
}

async function handleApplicationDenied(eventData) {
  const applicationId = eventData.relationships?.application?.data?.id;
  const user = applicationId ? await User.findOne({ unitApplicationId: applicationId }) : null;
  if (user) {
    user.status = 'denied';
    await user.save();
    console.log(`User ${user.email} application denied`);
  }
}

async function handleApplicationCreated(eventData) {
  const userId = eventData.attributes.tags?.userId;
  const applicationId = eventData.relationships.application.data.id;
  if (!userId) {
    console.warn('No userId found in tags for customer.created event');
    return;
  }
  const user = await User.findById(userId);
  if (!user) {
    console.warn(`No user found for userId: ${userId}`);
    return;
  }
  user.unitApplicationId = applicationId;
  user.status = 'pending';
  await user.save();
  console.log(process.env.VERCEL_ENV);
  if ('production' !== process.env.VERCEL_ENV) {
    await approveTestUserApplication(applicationId);
  }
}

async function handleCustomerCreated(eventData) {
  const userId = eventData.attributes.tags?.userId;
  const customerId = eventData.relationships.customer.data.id;
  if (!userId) {
    console.warn('No userId found in tags for customer.created event');
    return;
  }
  const user = await User.findById(userId);
  if (!user) {
    console.warn(`No user found for userId: ${userId}`);
    return;
  }
  user.unitCustomerId = customerId;
  user.status = 'approved';
  const depositAccountRequest = {
    type: 'depositAccount',
    attributes: {
      depositProduct: 'checking',
      tags: { purpose: 'savings' },
      idempotencyKey: `${user.email}-deposit-${Date.now()}`
    },
    relationships: {
      customer: { data: { type: 'customer', id: customerId } }
    }
  };
  try {
    const accountResponse = await unit.accounts.create(depositAccountRequest);
    user.unitAccountId = accountResponse.data.id;
    await user.save();
    console.log(`Deposit account created for user ${user.email} with accountId: ${user.unitAccountId}`);
    console.log(`User ${user.email} updated with unitCustomerId: ${user.unitCustomerId}, unitApplicationId: ${user.unitApplicationId}`);
  } catch (accountError) {
    console.error('Failed to create deposit account:', accountError.message, accountError.stack);
    user.status = 'pending';
    await user.save();
    throw new Error('Failed to create deposit account');
  }
}

async function handleApplicationAwaitingDocuments(eventData) {
  const applicationId = eventData.relationships?.application?.data?.id;
  const user = applicationId ? await User.findOne({ unitApplicationId: applicationId }) : null;
  if (user) {
    user.status = 'awaitingDocuments';
    await user.save();
    console.log(`User ${user.email} application awaiting documents`);
  }
}

async function handleApplicationPendingReview(eventData) {
  const applicationId = eventData.relationships?.application?.data?.id;
  const user = applicationId ? await User.findOne({ unitApplicationId: applicationId }) : null;
  if (user) {
    user.status = 'pendingReview';
    await user.save();
    console.log(`User ${user.email} application pending review`);
  }
}

async function handleDocumentApproved(eventData) {
  console.log('document approved', eventData);
}

async function handleMerchantApplicationCreated(eventData) {
  const merchantId = eventData.attributes.tags?.merchantId;
  const applicationId = eventData.relationships.application.data.id;
  
  if (!merchantId) {
    console.warn('No merchantId found in tags for merchant application.created event');
    return;
  }
  
  const merchant = await ShopifyMerchant.findById(merchantId);
  if (!merchant) {
    console.warn(`No merchant found for merchantId: ${merchantId}`);
    return;
  }

  merchant.unitApplicationId = applicationId;
  merchant.onboardingStatus = 'in_progress';
  await merchant.save();
  
  console.log(`Merchant ${merchant.shopifyShopId} application created with applicationId: ${applicationId}`);
}

async function handleMerchantApplicationApproved(eventData) {
  const merchantId = eventData.attributes.tags?.merchantId;
  const applicationId = eventData.relationships.application.data.id;
  
  if (!merchantId) {
    console.warn('No merchantId found in tags for merchant application.approved event');
    return;
  }
  
  const merchant = await ShopifyMerchant.findById(merchantId);
  if (!merchant) {
    console.warn(`No merchant found for merchantId: ${merchantId}`);
    return;
  }

  if (merchant.onboardingStatus !== 'completed') {
    merchant.onboardingStatus = 'in_progress';
    await merchant.save();
  }

  const user = await User.findOne({ shopifyMerchantId: merchantId });
  if (user) {
    user.status = 'approved';
    await user.save();
    console.log(`User ${user.email} status updated to approved for merchant ${merchant.shopifyShopId}`);
  } else {
    console.warn(`No user found for merchantId: ${merchantId}`);
  }
  
  console.log(`Merchant ${merchant.shopifyShopId} application approved with applicationId: ${applicationId}`);
}

async function handleMerchantCustomerCreated(eventData) {
  const merchantId = eventData.attributes.tags?.merchantId;
  const customerId = eventData.relationships.customer.data.id;
  
  console.log(`Processing merchant customer.created webhook for merchantId: ${merchantId}, customerId: ${customerId}`);
  
  if (!merchantId) {
    console.warn('No merchantId found in tags for merchant customer.created event');
    return;
  }
  
  const merchant = await ShopifyMerchant.findById(merchantId);
  if (!merchant) {
    console.warn(`No merchant found for merchantId: ${merchantId}`);
    return;
  }
  
  console.log(`Found merchant ${merchant.shopifyShopId}, current status: ${merchant.onboardingStatus}`);

  merchant.unitCustomerId = customerId;
  await merchant.save();
  
  console.log(`Merchant ${merchant.shopifyShopId} customer created with customerId: ${customerId}`);

  const depositAccountRequest = {
    type: 'depositAccount',
    attributes: {
      depositProduct: 'checking',
      tags: { 
        purpose: 'merchant_deposit',
        merchantId: merchantId.toString(),
        source: 'shopify-stashpay'
      },
      idempotencyKey: `${merchant.shopifyShopId}-deposit-${Date.now()}`
    },
    relationships: {
      customer: { data: { type: 'customer', id: customerId } }
    }
  };
  
  try {
    const accountResponse = await unit.accounts.create(depositAccountRequest);
    const accountId = accountResponse.data.id;

    merchant.unitAccountId = accountId;
    merchant.onboardingStatus = 'completed';
    await merchant.save();
    
    console.log(`Merchant ${merchant.shopifyShopId} deposit account created with accountId: ${accountId}, onboarding completed`);
  } catch (accountError) {
    console.error('Failed to create deposit account for merchant:', accountError.message);
    merchant.onboardingStatus = 'in_progress';
    await merchant.save();
    throw new Error('Failed to create deposit account for merchant');
  }
}

async function handleMerchantAccountCreated(eventData) {
  const merchantId = eventData.attributes.tags?.merchantId;
  const accountId = eventData.relationships.account.data.id;
  
  console.log(`Processing merchant account.created webhook for merchantId: ${merchantId}, accountId: ${accountId}`);
  
  if (!merchantId) {
    console.warn('No merchantId found in tags for merchant account.created event');
    return;
  }
  
  const merchant = await ShopifyMerchant.findById(merchantId);
  if (!merchant) {
    console.warn(`No merchant found for merchantId: ${merchantId}`);
    return;
  }
  
  console.log(`Found merchant ${merchant.shopifyShopId}, current status: ${merchant.onboardingStatus}`);

  if (!merchant.unitAccountId) {
    merchant.unitAccountId = accountId;
    merchant.onboardingStatus = 'completed';
    await merchant.save();
    console.log(`Merchant ${merchant.shopifyShopId} account ID updated via account.created webhook: ${accountId}`);
  } else {
    console.log(`Merchant ${merchant.shopifyShopId} account already exists, no update needed`);
  }
}

const webhook = async (req, res) => {
  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!Array.isArray(event.data)) {
      console.error('Invalid webhook payload: data is not an array');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }
  } catch (parseError) {
    console.error('Failed to parse webhook body:', parseError.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  for (const eventData of event.data) {
    switch (eventData.type) {
      case 'application.approved':
        if (eventData.attributes.tags?.merchantId) {
          await handleMerchantApplicationApproved(eventData);
        } else {
          await handleApplicationApproved(eventData);
        }
        break;
      case 'application.denied':
        await handleApplicationDenied(eventData);
        break;
      case 'customer.created':
        if (eventData.attributes.tags?.merchantId) {
          await handleMerchantCustomerCreated(eventData);
        } else {
          await handleCustomerCreated(eventData);
        }
        break;
      case 'account.created':
        if (eventData.attributes.tags?.merchantId) {
          await handleMerchantAccountCreated(eventData);
        } else {
          console.log('Regular account.created event (not merchant)');
        }
        break;
      case 'application.awaitingDocuments':
        await handleApplicationAwaitingDocuments(eventData);
        break;
      case 'application.pendingReview':
        await handleApplicationPendingReview(eventData);
        break;
      case 'application.created':
        if (eventData.attributes.tags?.merchantId) {
          await handleMerchantApplicationCreated(eventData);
        } else {
          await handleApplicationCreated(eventData);
        }
        break;
      case 'document.approved':
        await handleDocumentApproved(eventData);
        break;
      case 'payment.created':
        await handlePaymentCreated(eventData);
        break;
      case 'payment.clearing':
        await handlePaymentClearing(eventData);
        break;
      case 'payment.sent':
        await handlePaymentSent(eventData);
        break;
      case 'payment.rejected':
        await handlePaymentRejected(eventData);
        break;
      case 'payment.returned':
        await handlePaymentReturned(eventData);
        break;
      case 'payment.canceled':
        await handlePaymentCanceled(eventData);
        break;
      case 'transaction.created':
        await handleTransactionCreated(eventData);
        break;

      default:
        console.log('unrecognized event', eventData.type);
    }
  }
  res.status(200).json({ received: true });
}

module.exports = {
  webhook,
  handleMerchantApplicationCreated,
  handleMerchantApplicationApproved,
  handleMerchantCustomerCreated,
  handleMerchantAccountCreated,
  setUnitInstance,
  // Payment webhooks
  handlePaymentCreated,
  handlePaymentClearing,
  handlePaymentSent,
  handlePaymentRejected,
  handlePaymentReturned,
  handlePaymentCanceled,
  // User webhooks
  handleApplicationCreated,
  handleApplicationApproved,
  handleApplicationDenied,
  handleCustomerCreated,
  handleApplicationAwaitingDocuments,
  handleApplicationPendingReview,
  handleDocumentApproved,
  // Transaction webhooks
  handleTransactionCreated
};