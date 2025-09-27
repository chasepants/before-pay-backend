const mongoose = require('mongoose');
require('dotenv').config();
const { processScheduledPayments } = require('./process-payments');

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
  console.log('This simulates what the /api/cron/process-payments endpoint would do');
  
  try {
    console.log('Cron job started at:', new Date().toISOString());
    await processScheduledPayments(simulationDate);
    console.log('Cron job completed at:', new Date().toISOString());
    console.log('Simulation completed successfully');
  } catch (error) {
    console.error('Cron simulation failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

const simulationDate = process.argv[2];
simulateDailyPayments(simulationDate).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});