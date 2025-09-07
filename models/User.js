const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  googleId: { type: String, sparse: true }, // sparse: true allows multiple null values c
  firebaseUid: String, // For email/password authentication
  firstName: String,
  lastName: String,
  status: { type: String, default: 'pending' },
  unitApplicationId: String,
  unitCustomerId: String,
  unitAccountId: String,
  unitApplicationFormId: String,
  unitApplicationFormToken: String,
  unitApplicationFormExpiration: Date,
  unitApplicationFormUrl: String,
});

// Drop the existing unique index on googleId if it exists
UserSchema.index({ googleId: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('User', UserSchema);