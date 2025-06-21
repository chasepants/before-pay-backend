// backend/models/SavingsGoal.js
const mongoose = require('mongoose');

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
  delivery: { type: String }
});

module.exports = mongoose.model('SavingsGoal', savingsGoalSchema);