const mongoose = require('mongoose');

const launchUserSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  source: { type: String, default: 'landing_page' } // Track where they came from
});

module.exports = mongoose.model('LaunchUser', launchUserSchema);
