const mongoose = require('mongoose');
const WishlistItem = require('../models/WishlistItem');
const User = require('../models/User');

const savingsGoalService = {
  findByDate: async (targetDate) => {
    return await WishlistItem.find({
      nextRunnable: { $lte: targetDate },
      fundingSourceId: { $exists: true }
    });
  },

  findUserById: async (userId) => {
    const user = await User.findById(userId);
    return user ? user.toObject() : null; // Return plain object to avoid Mongoose-specific methods
  },

  save: async (item) => {
    return await item.save();
  }
};

module.exports = savingsGoalService;