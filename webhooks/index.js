const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

async function handlePaymentSent(eventData) {
  const paymentId = eventData.relationships?.payment?.data?.id;
  if (!paymentId) {
    console.warn('No payment ID found in event data:', eventData);
    return; // Exit early if no payment ID
  }

  try {
    // Find the SavingsGoal containing the transfer with the matching transferId
    const savingsGoal = await SavingsGoal.findOne({ 'transfers.transferId': paymentId });
    if (!savingsGoal) {
      console.warn(`No savings goal found for payment with id: ${paymentId}`);
      return;
    }

    // Update the status of the matching transfer to 'completed'
    const transferIndex = savingsGoal.transfers.findIndex(t => t.transferId === paymentId);
    if (transferIndex === -1) {
      console.warn(`No matching transfer found for payment ${paymentId} in goal ${savingsGoal._id}`);
      return;
    }

    savingsGoal.transfers[transferIndex].status = 'completed';
    savingsGoal.currentAmount += savingsGoal.transfers[transferIndex].amount;
    await savingsGoal.save();
    console.log(`Updated transfer ${paymentId} status to 'completed' for savings goal ${savingsGoal._id}`);
  } catch (error) {
    console.error(`Error handling payment sent for payment ${paymentId}:`, error.message, error.stack);
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
  user.status = "pending";

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
      customer: {
        data: { type: 'customer', id: customerId }
      }
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
      case 'payment.sent':
        await handlePaymentSent(eventData);
        break;
      default:
        console.log('unrecognized event', eventData.type);
    }
  }
  res.status(200).json({ received: true });
};

module.exports = webhook;