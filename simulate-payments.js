// simulate-daily-payments.js
const mongoose = require('mongoose');
const { Unit } = require('@unit-finance/unit-node-sdk');
require('dotenv').config();
const User = require('./models/User'); // Adjust path as needed
const SavingsGoal = require('./models/SavingsGoal'); // Adjust path as needed

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

const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

async function simulateDailyPayments(simulationDate) {
  if (!simulationDate) {
    console.error('Error: Simulation date is required. Run with: node simulate-daily-payments.js YYYY-MM-DD');
    process.exit(1);
  }

  await connectDB();

  console.log(`Simulating payments for ${simulationDate}`);

  const savingsGoals = await SavingsGoal.find({
    nextRunnable: new Date(simulationDate)
  });

  for (const goal of savingsGoals) {
    try {
      const { savingsAmount, savingsFrequency, plaidToken, userId } = goal;
      const user = await User.findById(userId);
      if (!user || !user.unitAccountId) {
        console.warn(`Skipping goal ${goal._id}: User or unitAccountId not found`);
        continue;
      }

      console.log(`Processing payment for savings goal ${goal._id} (userId: ${userId})`);

      const achPaymentRequest = {
        type: 'achPayment',
        attributes: {
          amount: parseFloat(savingsAmount) * 100, // Convert to cents
          direction: 'Debit',
          description: `Funding`,
          plaidProcessorToken: plaidToken,
          tags: { savingsGoalId: goal._id }
        },
        relationships: {
          account: {
            data: {
              type: 'account',
              id: user.unitAccountId
            }
          }
        }
      };

      const achPayment = await unit.payments.create(achPaymentRequest);
      console.log(`ACH payment created for goal ${goal._id}: ${achPayment.data.id}`);

      goal.transfers.push({
        transferId: achPayment.data.id,
        amount: parseFloat(savingsAmount),
        date: new Date(),
        status: 'pending',
        type: 'debit'
      });

      // Update nextRunnable
      const intervalMs = savingsFrequency === 'Weekly' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
      const nextRunnableDate = new Date(goal.nextRunnable);
      goal.nextRunnable = new Date(nextRunnableDate.getTime() + intervalMs);

      await goal.save();
    } catch (error) {
      console.log(error)
      console.error(`Error processing goal ${goal._id}:`, error.message);
    }
  }
  console.log('Daily payment simulation completed');
  await mongoose.connection.close();
  process.exit(0);
}

// Parse command-line date argument (e.g., node simulate-daily-payments.js 2025-07-23)
const simulationDate = process.argv[2];
simulateDailyPayments(simulationDate).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});