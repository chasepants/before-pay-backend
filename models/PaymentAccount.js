const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const paymentAccountSchema = new Schema({
  // User who owns this payment account
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Bank account information
  bankName: String,
  bankAccountName: String,
  bankLastFour: String,
  accountType: {
    type: String,
    enum: ['savings', 'checking'],
    required: true
  },
  
  // Plaid processor token (for ACH payments)
  plaidProcessorToken: {
    type: String,
    required: true
  },
  
  // For merchant accounts, link to shop domain
  // If shopDomain is set, this is a merchant account (unitAccountId from ShopifyMerchant)
  // If shopDomain is null, this is a user account (unitAccountId from User)
  shopDomain: {
    type: String,
    sparse: true,
    index: true
  },
  
  // Metadata
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
paymentAccountSchema.index({ userId: 1, isActive: 1 });
paymentAccountSchema.index({ shopDomain: 1, isActive: 1 });

module.exports = mongoose.model('PaymentAccount', paymentAccountSchema);

