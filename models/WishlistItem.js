// backend/models/WishlistItem.js
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

const wishlistItemSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  price: { type: String, required: true },
  old_price: { type: String, required: true },
  extracted_price: { type: Number, required: true },
  extracted_old_price: { type: Number, required: true },
  product_link: { type: String, required: true },
  product_id: { type: String, required: true },
  serpapi_product_api: { type: String, required: true },
  thumbnail: { type: String, required: true },
  source: { type: String, required: true },
  source_icon: { type: String, required: true },
  rating: { type: Number },
  reviews: { type: Number },
  store_rating: { type: Number },
  store_reviews: { type: Number },
  badge: { type: String },
  tag: { type: String },
  delivery: { type: String },
  savings_goal: { type: Number, required: true },
  savings_progress: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  fundingSourceId: String,
  savingsAmount: Number,
  savingsFrequency: String,
  savingsStartDate: String,
  bankName: String,
  bankAccountName: String,
  nextRunnable: { type: Date, default: null }, // Add this field
  transfers: [transferSchema] // Add transfers array
});

module.exports = mongoose.model('WishlistItem', wishlistItemSchema);