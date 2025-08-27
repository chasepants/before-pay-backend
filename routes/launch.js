const express = require('express');
const router = express.Router();
const LaunchUser = require('../models/LaunchUser');

// POST /api/launch/notify - Save launch notification
router.post('/notify', async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    
    // Basic validation
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }
    
    // Check if email already exists
    const existingUser = await LaunchUser.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered for launch notifications' });
    }
    
    // Create new launch user
    const launchUser = new LaunchUser({
      firstName,
      lastName,
      email
    });
    
    await launchUser.save();
    
    res.status(201).json({ 
      message: 'Successfully registered for launch notifications!',
      user: { firstName, lastName, email }
    });
  } catch (error) {
    console.error('Launch notification error:', error);
    res.status(500).json({ error: 'Failed to register for launch notifications' });
  }
});

module.exports = router;
