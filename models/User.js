const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  googleId: String,
  status: { type: String, default: 'pending' },
  unitApplicationId: String,
  unitCustomerId: String,
  unitAccountId: String,
  unitApplicationFormId: String,
  unitApplicationFormToken: String,
  unitApplicationFormExpiration: Date,
  unitApplicationFormUrl: String,
});
module.exports = mongoose.model('User', UserSchema);