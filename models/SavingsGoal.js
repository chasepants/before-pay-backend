const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const transferSchema = new Schema({
  transferId: { type: String, required: true }, // Unit payment ID
  amount: { type: Number, required: true },    // Amount in dollars
  date: { type: Date, required: true },       // Transfer creation date
  status: { type: String, required: true },   // e.g., "pending", "completed", "failed"
  type: { type: String, required: true },     // "debit" or "credit"
});

const googleProductSchema = new Schema({
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
  description: { type: String }
});

const scheduleSchema = new Schema({
  startDate: Date,
  interval: String,
  dayOfMonth: Number,
  dayOfWeek: String
})

const bankSchema = new Schema({
  bankName: String,
  bankAccountName: String,
  bankLastFour: String,
  bankAccountType: String
})

const savingsGoalSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  goalName: { type: String, required: true },
  description: { type: String },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  savingsAmount: Number,
  product: { type: googleProductSchema, required: false },
  schedule: scheduleSchema,
  bank: bankSchema,
  plaidToken: String,
  transfers: [transferSchema],
  isPaused: { type: Boolean, default: false }
});

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);