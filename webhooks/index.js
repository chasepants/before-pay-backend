const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

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

async function handleCustomerCreated(eventData) {
  const applicationId = eventData.relationships.application.data.id;
  const user = await User.findOne({ unitApplicationId: applicationId });
  if (user) {
    user.status = 'approved';
    user.unitCustomerId = eventData.relationships.customer.data.id;

    const depositAccountRequest = {
      type: 'depositAccount',
      attributes: {
        depositProduct: 'checking',
        tags: { purpose: 'savings' },
        idempotencyKey: `${user.email}-deposit-${Date.now()}`
      },
      relationships: {
        customer: {
          data: { type: 'customer', id: user.unitCustomerId }
        }
      }
    };
    try {
      const accountResponse = await unit.accounts.create(depositAccountRequest);
      user.unitAccountId = accountResponse.data.id;
      await user.save();
      console.log(`Deposit account created for user ${user.email} with accountId: ${user.unitAccountId}`);
    } catch (accountError) {
      console.error('Failed to create deposit account:', accountError.message, accountError.stack);
      user.status = 'pending';
      await user.save();
      throw new Error('Failed to create deposit account');
    }
    console.log(`User ${user.email} customer created with unitCustomerId: ${user.unitCustomerId}`);
  } else {
    console.warn(`No user found for applicationId: ${applicationId}`);
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
      case 'document.approved':
        await handleDocumentApproved(eventData);
        break;
      default:
        console.log('unrecognized event', eventData.type);
    }
  }
  res.status(200).json({ received: true });
};

module.exports = webhook;