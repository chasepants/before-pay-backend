const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
  googleId: { type: String, required: true, unique: true },
  name: String,
  email: String
});

module.exports = mongoose.model('User', userSchema);