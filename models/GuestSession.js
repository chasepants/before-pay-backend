const mongoose = require('mongoose');

const guestSessionSchema = new mongoose.Schema({
  email: { type: String, required: true },
  guestToken: { type: String, required: true, unique: true },
  plaidToken: { type: String },
  plaidAccountId: { type: String },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
}, { timestamps: true });

module.exports = mongoose.model('GuestSession', guestSessionSchema);

