// backend/models/SavingsGoal.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transferSchema = new Schema({
  transferId: { type: String, required: true }, // Dwolla transfer ID
  amount: { type: Number, required: true },    // Amount in dollars
  date: { type: Date, required: true },       // Transfer creation date
  status: { type: String, required: true },   // e.g., "pending", "completed", "failed"
  type: { type: String, required: true },     // "debit" or "credit"
  metadata: { type: Object }                  // Additional metadata (e.g., wishlistItemId)
});

const savingsGoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  goalName: { type: String, required: true },
  description: { type: String }, // Optional, from manual form
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  productLink: { type: String }, // Optional, from manual form or product
  title: { type: String }, // For SerpAPI products
  price: { type: String },
  old_price: { type: String },
  extracted_price: { type: Number },
  extracted_old_price: { type: Number },
  product_id: { type: String },
  serpapi_product_api: { type: String },
  thumbnail: { type: String },
  source: { type: String },
  source_icon: { type: String },
  rating: { type: Number },
  reviews: { type: Number },
  badge: { type: String },
  tag: { type: String },
  delivery: { type: String },
  savingsAmount: Number,
  savingsFrequency: String,
  savingsStartDate: String,
  bankName: String,
  bankAccountName: String,
  bankLastFour: String,
  bankAccountType: String,
  externalAccountId: String,
  plaidToken: String,
  nextRunnable: { type: Date, default: null },
  transfers: [transferSchema]
});

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);