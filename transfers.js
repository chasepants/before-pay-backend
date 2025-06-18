// backend/transfers.js
const mongoose = require('mongoose');
const dwolla = require('dwolla-v2');
const WishlistItem = require('./models/WishlistItem');
const User = require('./models/User');
require('dotenv').config();

const dwollaClient = new dwolla.Client({
  key: process.env.DWOLLA_KEY,
  secret: process.env.DWOLLA_SECRET,
  environment: process.env.DWOLLA_ENVIRONMENT
});

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('MongoDB connected');
    const targetDate = new Date(process.argv[2]); // Expect date as first argument (e.g., "06/16/2025")
    if (isNaN(targetDate.getTime())) {
      console.error('Invalid date format. Use MM/DD/YYYY');
      process.exit(1);
    }

    // Find wishlist items ready for transfer
    const wishlistItems = await WishlistItem.find({
      nextRunnable: { $lte: targetDate },
      fundingSourceId: { $exists: true }
    });

    if (wishlistItems.length === 0) {
      console.log('No wishlist items ready for transfer on', targetDate);
      process.exit(0);
    }

    for (const item of wishlistItems) {
      const user = await User.findById(item.userId);
      if (!user || !user.dwollaCustomerId) {
        console.error(`User not found or not set up for wishlist item ${item._id}`);
        continue;
      }

      try {
        const transferResponse = await dwollaClient.post('transfers', {
          _links: {
            source: { href: `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${item.fundingSourceId}` },
            destination: { href: `https://api-${process.env.DWOLLA_ENVIRONMENT}.dwolla.com/funding-sources/${process.env.DWOLLA_FUNDING_SOURCE_ID}` }
          },
          amount: {
            currency: 'USD',
            value: item.savingsAmount.toString()
          },
          clearing: {
            source: 'next-available'
          },
          metadata: {
            wishlistItemId: item._id
          }
        });
        console.log(`Transfer initiated for wishlist item ${item._id}:`, transferResponse.headers.get('location'));

        // Update nextRunnable based on frequency
        const frequencyMap = { week: 7, biweek: 14, month: 30 }; // Days
        const daysToAdd = frequencyMap[item.savingsFrequency] || 7;
        item.nextRunnable = new Date(item.nextRunnable.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        item.savings_progress += item.savingsAmount; // Update savings progress

        const transferId = transferResponse.headers.get('location').split('/').pop();
        const transferDate = new Date();
        item.transfers.push({
          transferId,
          amount: item.savingsAmount,
          date: transferDate,
          status: 'pending', // Initial status, update via webhook
          type: 'debit'
        });

        await item.save();
        console.log(`Updated nextRunnable to ${item.nextRunnable} and savings_progress to ${item.savings_progress} for ${item._id}`);
      } catch (error) {
        console.error(`Failed to initiate transfer for wishlist item ${item._id}:`, error.message);
      }
    }

    process.exit(0);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });