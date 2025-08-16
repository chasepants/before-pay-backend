// backend/models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  googleId: { type: String, unique: true },
  unitApplicationId: { type: String },
  unitCustomerId: { type: String },
  unitAccountId: { type: String },
  status: { type: String, enum: ['pending', 'awaitingDocuments', 'pendingReview', 'approved', 'denied'], default: 'pending' },
  address: {
    line1: String,
    city: String,
    state: String,
    postalCode: String
  },
  ssnLast4: String,
  dateOfBirth: Date,
  plaidAccessToken: { type: String },
  firstName: { type: String },
  lastName: { type: String },
  phone: { type: String },
  sourceOfIncome: { type: String },
  annualIncome: { type: String },
  occupation: { type: String },
  documents: [{ type: String }] // Array to store document URLs or references
});

module.exports = mongoose.model('User', userSchema);