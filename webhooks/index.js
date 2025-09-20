const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const ShopifyMerchant = require('../models/ShopifyMerchant');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');
const axios = require('axios');

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

    // Debug: Check what goals exist with this batchId
    const allGoals = await SavingsGoal.find({});
    const goalsWithBatch = allGoals.filter(g => g.transfers.some(t => t.batchId === batchId));
    console.log(`Total goals in DB: ${allGoals.length}`);
    console.log(`Goals with batchId ${batchId}: ${goalsWithBatch.length}`);
    goalsWithBatch.forEach(g => {
      console.log(`Goal ${g._id} (${g.goalName}) has ${g.transfers.filter(t => t.batchId === batchId).length} transfers with batchId ${batchId}`);
    });

    // Find all goals that have pending credit transfers for this batch
    const goals = await SavingsGoal.find({ 'transfers.batchId': batchId });
    console.log(`Found ${goals.length} goals for batch ${batchId}`);
    
    // Also try a different query approach
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

        // Use findOneAndUpdate to update the specific transfer
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

  // existing single-payment flow fallback
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
  
  // Save the Unit application ID
  merchant.unitApplicationId = applicationId;
  merchant.onboardingStatus = 'in_progress';
  merchant.kybStatus = 'in_progress';
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
  
  // Update merchant status to approved
  merchant.onboardingStatus = 'in_progress';
  merchant.kybStatus = 'approved';
  await merchant.save();
  
  console.log(`Merchant ${merchant.shopifyShopId} application approved with applicationId: ${applicationId}`);
}

async function handleMerchantCustomerCreated(eventData) {
  const merchantId = eventData.attributes.tags?.merchantId;
  const customerId = eventData.relationships.customer.data.id;
  
  if (!merchantId) {
    console.warn('No merchantId found in tags for merchant customer.created event');
    return;
  }
  
  const merchant = await ShopifyMerchant.findById(merchantId);
  if (!merchant) {
    console.warn(`No merchant found for merchantId: ${merchantId}`);
    return;
  }
  
  // Create a deposit account for the merchant
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
    
    // Update merchant with customer and account IDs
    merchant.unitAccountId = accountId;
    merchant.onboardingStatus = 'completed';
    merchant.kybStatus = 'approved';
    merchant.isEnabled = true;
    await merchant.save();
    
    console.log(`Merchant ${merchant.shopifyShopId} onboarding completed with customerId: ${customerId}, accountId: ${accountId}`);
  } catch (accountError) {
    console.error('Failed to create deposit account for merchant:', accountError.message);
    merchant.onboardingStatus = 'in_progress';
    merchant.kybStatus = 'in_progress';
    await merchant.save();
    throw new Error('Failed to create deposit account for merchant');
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
        // Check if this is a merchant application (has merchantId in tags)
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
        // Check if this is a merchant customer (has merchantId in tags)
        if (eventData.attributes.tags?.merchantId) {
          await handleMerchantCustomerCreated(eventData);
        } else {
          await handleCustomerCreated(eventData);
        }
        break;
      case 'application.awaitingDocuments':
        await handleApplicationAwaitingDocuments(eventData);
        break;
      case 'application.pendingReview':
        await handleApplicationPendingReview(eventData);
        break;
      case 'application.created':
        // Check if this is a merchant application (has merchantId in tags)
        if (eventData.attributes.tags?.merchantId) {
          await handleMerchantApplicationCreated(eventData);
        } else {
          await handleApplicationCreated(eventData);
        }
        break;
      case 'document.approved':
        await handleDocumentApproved(eventData);
        break;

      // Payments lifecycle
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

module.exports = webhook;