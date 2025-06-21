const mongoose = require('mongoose');
const processTransfersForDate = require('./services/transfersService');
const wishlistItemService = require('./services/wishlistItemService');
const unitService = require('./services/unitService');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('MongoDB connected');

    const targetDate = new Date(process.argv[2]); // Expect date as first argument (e.g., "06/16/2025")
    if (isNaN(targetDate.getTime())) {
      console.error('Invalid date format. Use MM/DD/YYYY');
      process.exit(1);
    }

    try {
      await processTransfersForDate(targetDate, wishlistItemService, unitService);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }

    console.log('Finished processing transfers for:', targetDate);
    process.exit(0);
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });