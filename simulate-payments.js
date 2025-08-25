const mongoose = require('mongoose');
const { Unit } = require('@unit-finance/unit-node-sdk');
require('dotenv').config();
const User = require('./models/User');
const SavingsGoal = require('./models/SavingsGoal');

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
  
  // Fix: Parse the date more explicitly to avoid timezone issues
  const [year, month, day] = simulationDate.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed in JavaScript
  
  const dayOfTheMonth = date.getDate();
  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfTheWeek = daysOfWeek[date.getDay()];
  
  console.log({ "schedule.dayOfTheMonth": dayOfTheMonth },
      { "schedule.dayOfTheWeek": dayOfTheWeek });
  
  // Add debug logging to verify the date
  console.log(`Parsed date: ${date.toDateString()}`);
  console.log(`Day of week index: ${date.getDay()}`);
  
  const savingsGoals = await SavingsGoal.find({
    $or: [
      { "schedule.dayOfMonth": dayOfTheMonth },
      { "schedule.dayOfWeek": dayOfTheWeek }
    ]
  });
  
  console.log(`Found ${savingsGoals.length} savings goals for ${dayOfTheWeek} (${dayOfTheMonth})`);
  console.log(savingsGoals);
  
  for (const goal of savingsGoals) {
    try {
      const { savingsAmount, plaidToken, userId } = goal;
      const user = await User.findById(userId);
      if (!user || !user.unitAccountId) {
        console.warn(`Skipping goal ${goal._id}: User or unitAccountId not found`);
        continue;
      }

      console.log(`Processing payment for savings goal ${goal._id} (userId: ${userId}, plaid: ${plaidToken})`);

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

const simulationDate = process.argv[2];
simulateDailyPayments(simulationDate).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});