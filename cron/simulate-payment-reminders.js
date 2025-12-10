const mongoose = require('mongoose');
require('dotenv').config();
const { sendPaymentReminders } = require('./send-payment-reminders');
const SavingsGoal = require('../models/SavingsGoal');
const User = require('../models/User');

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

async function simulatePaymentReminders(testDate = null) {
  await connectDB();

  console.log(`Simulating payment reminders cron job`);
  if (testDate) {
    console.log(`Using test date: ${testDate}`);
  } else {
    console.log('Using current date (will find goals scheduled for tomorrow)');
  }
  console.log('This simulates what the /api/cron/send-payment-reminders endpoint would do');
  
  try {
    // Show current state before processing
    const allGoals = await SavingsGoal.find({}).sort({ _id: 1 });
    const activeGoals = await SavingsGoal.find({
      isPaused: false
    }).sort({ _id: 1 });

    console.log('\n=== CURRENT STATE ===');
    console.log(`Total goals: ${allGoals.length}`);
    console.log(`Active goals (not paused): ${activeGoals.length}`);
    
    if (activeGoals.length > 0) {
      console.log('\nActive goals:');
      for (const goal of activeGoals.slice(0, 10)) { // Show first 10
        let email = 'No email';
        if (goal.userId) {
          const user = await User.findById(goal.userId);
          if (user && user.email) {
            email = user.email;
          }
        }
        if (!email || email === 'No email') {
          email = goal.guestEmail || 'No email';
        }
        
        const scheduleInfo = goal.schedule 
          ? `dayOfMonth: ${goal.schedule.dayOfMonth || 'N/A'}, dayOfWeek: ${goal.schedule.dayOfWeek || 'N/A'}`
          : 'No schedule';
        
        console.log(`  - ${goal.goalName} (${goal._id})`);
        console.log(`    Email: ${email}`);
        console.log(`    Savings Amount: $${goal.savingsAmount || 0}`);
        console.log(`    Schedule: ${scheduleInfo}`);
      }
      if (activeGoals.length > 10) {
        console.log(`  ... and ${activeGoals.length - 10} more`);
      }
    }

    console.log('\n=== PROCESSING PAYMENT REMINDERS ===');
    console.log('Cron job started at:', new Date().toISOString());
    
    await sendPaymentReminders(testDate);
    
    console.log('Cron job completed at:', new Date().toISOString());

    console.log('\nSimulation completed successfully');
  } catch (error) {
    console.error('Cron simulation failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

// Parse command line arguments
const testDateArg = process.argv[2];

let testDate = null;
if (testDateArg) {
  // Try to parse as ISO date string or other formats
  testDate = new Date(testDateArg);
  if (isNaN(testDate.getTime())) {
    console.error('Error: Invalid date format.');
    console.error('Usage: node simulate-payment-reminders.js [test_date]');
    console.error('Examples:');
    console.error('  node simulate-payment-reminders.js                    # Use current date');
    console.error('  node simulate-payment-reminders.js 2024-12-15         # Use specific date');
    console.error('  node simulate-payment-reminders.js 2024-12-15T00:00:00Z  # Use ISO date');
    process.exit(1);
  }
}

simulatePaymentReminders(testDate).catch(error => {
  console.error('Simulation failed:', error);
  process.exit(1);
});

