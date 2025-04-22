const mongoose = require('mongoose');
const Schema = mongoose.Schema;

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
  stripeCustomerId: String,
  paymentMethodId: String,
  subscriptionId: String
});

module.exports = mongoose.model('WishlistItem', wishlistItemSchema);