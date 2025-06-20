// backend/services/dwollaService.js
const dwolla = require('dwolla-v2');
require('dotenv').config();

const dwollaClient = new dwolla.Client({
  key: process.env.DWOLLA_KEY,
  secret: process.env.DWOLLA_SECRET,
  environment: process.env.DWOLLA_ENVIRONMENT
});

const dwollaService = {
  initiateTransfer: async (sourceHref, destinationHref, amount, metadata) => {
    const response = await dwollaClient.post('transfers', {
      _links: {
        source: { href: sourceHref },
        destination: { href: destinationHref }
      },
      amount: {
        currency: 'USD',
        value: amount.toString()
      },
      clearing: {
        source: 'next-available'
      },
      metadata
    });
    return response;
  }
};

module.exports = dwollaService;