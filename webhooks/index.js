const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

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
  
  if (kind === 'transferBackBatch') {
    const batchId = tags.batchId;
    if (!batchId) return;

    // Update all transfers in the batch using positional operator
    await SavingsGoal.updateMany(
      { 'transfers.batchId': batchId, 'transfers.type': 'credit', 'transfers.status': { $ne: 'completed' } },
      { 
        $set: { 
          'transfers.$.status': 'completed',
          'transfers.$.transactionId': transactionId
        },
        $inc: { currentAmount: { $multiply: ['$transfers.$.amount', -1] } }
      }
    );
    
    console.log(`transaction.created → completed batch ${batchId}, transactionId: ${transactionId}`);
    return;
  }

  // existing single-payment flow fallback
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) return;
  
  // Update single transfer using positional operator
  await SavingsGoal.updateOne(
    { 'transfers.transferId': paymentId, 'transfers.status': { $ne: 'completed' } },
    { 
      $set: { 
        'transfers.$.status': 'completed',
        'transfers.$.transactionId': transactionId
      },
      $inc: { 
        currentAmount: eventData.attributes?.direction === 'Credit' ? 
          { $multiply: ['$transfers.$.amount', -1] } : 
          '$transfers.$.amount'
      }
    }
  );
  
  console.log(`transaction.created → completed for transfer ${paymentId}, transactionId: ${transactionId}`);
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
        await handleApplicationApproved(eventData);
        break;
      case 'application.denied':
        await handleApplicationDenied(eventData);
        break;
      case 'customer.created':
        await handleCustomerCreated(eventData);
        break;
      case 'application.awaitingDocuments':
        await handleApplicationAwaitingDocuments(eventData);
        break;
      case 'application.pendingReview':
        await handleApplicationPendingReview(eventData);
        break;
      case 'application.created':
        await handleApplicationCreated(eventData);
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
};

module.exports = webhook;