const mongoose = require('mongoose');

const shopifyMerchantSchema = new mongoose.Schema({
  shopifyShopId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  unitApplicationId: {
    type: String,
    default: null
  },
  unitCustomerId: {
    type: String,
    default: null
  },
  unitAccountId: {
    type: String,
    default: null
  },
  onboardingStatus: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rejected', 'suspended'],
    default: 'pending'
  },
  unitApplicationFormId: {
    type: String,
    default: null
  },
  unitApplicationFormUrl: {
    type: String,
    default: null
  },
  unitApplicationFormToken: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

shopifyMerchantSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

shopifyMerchantSchema.index({ shopifyShopId: 1 });
shopifyMerchantSchema.index({ onboardingStatus: 1 });
shopifyMerchantSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShopifyMerchant', shopifyMerchantSchema);
