const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  googleId: { type: String, sparse: true, unique: true },
  firebaseUid: String,
  firstName: String,
  lastName: String,
  status: { type: String, default: 'pending' },
  userType: { type: String, enum: ['guest', 'savings-account', 'merchant'], default: 'savings-account' },
  unitApplicationId: String,
  unitCustomerId: String,
  unitAccountId: String,
  unitApplicationFormId: String,
  unitApplicationFormToken: String,
  unitApplicationFormExpiration: Date,
  unitApplicationFormUrl: String,
  shopifyMerchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'ShopifyMerchant', sparse: true },
});

module.exports = mongoose.model('User', UserSchema);