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
  unitAccountId: {
    type: String,
    default: null
  },
  onboardingStatus: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'rejected', 'suspended'],
    default: 'pending'
  },
  kybStatus: {
    type: String,
    enum: ['not_started', 'in_progress', 'approved', 'rejected', 'requires_documents'],
    default: 'not_started'
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
  },
  isEnabled: {
    type: Boolean,
    default: false
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
shopifyMerchantSchema.index({ kybStatus: 1 });
shopifyMerchantSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ShopifyMerchant', shopifyMerchantSchema);
