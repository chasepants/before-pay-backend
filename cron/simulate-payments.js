const mongoose = require('mongoose');
require('dotenv').config();
const { processScheduledInstallments } = require('./process-installments');
const {processScheduledPayments} = require('./process-payments');

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
    await processScheduledInstallments(simulationDate);
    console.log('Installment simulation completed successfully');
  } catch (error) {
    console.error('Cron simulation for installations failed:', error);
  } 

  try {
    await processScheduledPayments(simulationDate);
    console.log('Payments simulation completed successfully');
  } catch (error) {
    console.error('Cron simulation for payments failed:', error);
  } 

  console.log('Cron job completed at:', new Date().toISOString());

}

const simulationDate = process.argv[2];
simulateDailyPayments(simulationDate).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});