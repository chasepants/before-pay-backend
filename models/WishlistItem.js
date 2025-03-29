const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const wishlistItemSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  url: { type: String, required: true },
  imageUrl: String,
  savingsGoal: { type: Number, required: true },
  savingsProgress: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WishlistItem', wishlistItemSchema);