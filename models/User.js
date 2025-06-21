const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  googleId: { type: String, unique: true }, // Use Google sub as unique ID
  unitApplicationId: { type: String }, // Optional, set during application
  unitCustomerId: { type: String }, // Added for customer.created webhook
  status: { type: String, enum: ['pending', 'approved'], default: 'pending' },
  address: {
    line1: String,
    city: String,
    state: String,
    postalCode: String
  },
  ssnLast4: String,
  dateOfBirth: Date,
  plaidAccessToken: String,
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  sourceOfIncome: { type: String },
  annualIncome: { type: String },
  occupation: { type: String }
});

// Remove or adjust the unique index if manually set
// userSchema.index({ googleId: 1 }, { unique: true }); // Uncomment and adjust if needed

module.exports = mongoose.model('User', userSchema);