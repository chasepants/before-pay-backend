const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
  googleId: { type: String, required: true, unique: true },
  name: String,
  email: String,
  wishlist: [{ type: Schema.Types.ObjectId, ref: 'WishlistItem' }]
});

module.exports = mongoose.model('User', userSchema);