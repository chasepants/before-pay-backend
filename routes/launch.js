const express = require('express');
const router = express.Router();
const LaunchUser = require('../models/LaunchUser');

router.post('/notify', async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;
    
    if (!firstName || !firstName.trim() || !lastName || !lastName.trim() || !email || !email.trim()) {
      return res.status(400).json({ error: 'First name, last name, and email are required' });
    }
    
    const existingUser = await LaunchUser.findOne({ email: email.trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered for launch notifications' });
    }
    
    const launchUser = new LaunchUser({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim()
    });
    
    await launchUser.save();
    
    res.status(201).json({ 
      message: 'Successfully registered for launch notifications!',
      user: { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() }
    });
  } catch (error) {
    console.error('Launch notification error:', error);
    res.status(500).json({ error: 'Failed to register for launch notifications' });
  }
});

module.exports = router;
