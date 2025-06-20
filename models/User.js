const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
  googleId: { type: String, required: true, unique: true },
  name: String,
  email: String,
  dwollaCustomerId: String,
  address: {
    line1: String,
    city: String,
    state: String,
    postal_code: String
  },
  ssnLast4: String,
  dateOfBirth: String
});

module.exports = mongoose.model('User', userSchema);