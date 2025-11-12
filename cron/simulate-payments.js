const mongoose = require('mongoose');
require('dotenv').config();
const { processScheduledPayments } = require('./process-scheduled-payments');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

async function simulateDailyPayments(simulationDate) {
  if (!simulationDate) {
    console.error('Error: Simulation date is required. Run with: node simulate-payments.js YYYY-MM-DD');
    process.exit(1);
  }

  await connectDB();

  console.log(`Simulating cron job for ${simulationDate}`);
  console.log('Cron job started at:', new Date().toISOString());

  try {
    // Use the unified processScheduledPayments which handles both manual and Shopify goals
    await processScheduledPayments(simulationDate);
    console.log('Payment simulation completed successfully');
  } catch (error) {
    console.error('Cron simulation for payments failed:', error);
  } 

  console.log('Cron job completed at:', new Date().toISOString());

  return;
}

const simulationDate = process.argv[2];
simulateDailyPayments(simulationDate).then(() => { 
  console.log("Simulation complete")
  process.exit(0);
}).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});
