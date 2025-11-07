const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');
const axios = require('axios');
const firebaseService = require('../services/firebaseService');
const { ensureAuthenticated } = require('../middleware/auth');

/**
 * Get current user
 * GET /api/users
 */
router.get('/', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    console.log('No token provided in /users');
    return res.json(null);
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    res.json(user || null);
  } catch (err) {
    console.error('Token verification error in /users:', err);
    res.json(null);
  }
});

/**
 * Update current user
 * PUT /api/users
 */
router.put('/', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { firstName, lastName, email } = req.body;
    
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (email !== undefined) user.email = email;

    await user.save();

    res.json({
      message: 'User updated successfully',
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        userType: user.userType
      }
    });
  } catch (error) {
    console.error('User update error:', error);
    res.status(500).json({ error: 'Failed to update user: ' + error.message });
  }
});

/**
 * Create a new user
 * POST /api/users
 */
router.post('/', async (req, res) => {
  try {
    const { email, password, firstName, lastName, userType } = req.body;

    // Validate required fields
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    if (userType && !['guest', 'savings-account'].includes(userType)) {
      return res.status(400).json({ error: 'Invalid user type' });
    }

    // Check if user already exists in our database
    let existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create user in Firebase
    let firebaseUser;
    try {
      firebaseUser = await firebaseService.createUserWithEmailAndPassword(
        email, 
        password, 
        firstName, 
        lastName
      );
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'This email is already registered. Please sign in instead.' });
      }
      throw error;
    }

    // Create user in our database
    const user = new User({
      email: firebaseUser.email,
      firebaseUid: firebaseUser.uid,
      firstName: firstName,
      lastName: lastName,
      status: 'pending',
      userType: userType || 'savings-account' // Default to savings-account if not specified
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '14d' });

    res.status(201).json({
      message: 'User created successfully',
      token: token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        userType: user.userType
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.code === 'auth/email-already-exists') {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    if (error.code === 'auth/weak-password') {
      return res.status(400).json({ error: 'Password is too weak' });
    }

    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

/**
 * Get customer token for current user
 * GET /api/users/customer-token
 */
router.get('/customer-token', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.unitCustomerId) {
      return res.status(400).json({ error: 'No Unit application found for user' });
    }
    const response = await unit.customerToken.createToken(user.unitCustomerId, {
      attributes: { scope: 'customers statements accounts authorizations transactions' },
      type: "customerToken"
    });
    console.log('Customer token generated:', response.data.attributes.token);
    res.json({ token: response.data.attributes.token });
  } catch (error) {
    console.error('Customer token error:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to generate customer token: ' + error.message });
  }
});

/**
 * Create Unit application form for current user
 * POST /api/users/unit-application-form
 */
router.post('/unit-application-form', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    let response;
    if (user.unitApplicationId) {
      response = await axios.post(
        'https://api.s.unit.sh/application-forms',
        {
          data: {
            type: 'applicationForm',
            attributes: {
              idempotencyKey: `${user._id}`,
              tags: { userId: user._id.toString() },
              applicantDetails: {
                email: user.email,
              }
            },
            relationships: {
              application: {
                data: { type: 'application', id: user.unitApplicationId }
              }
            }
          }
        },
        {
          headers: {
            'Content-Type': 'application/vnd.api+json',
            'Authorization': `Bearer ${process.env.UNIT_API_KEY}`,
            'X-Accept-Version': 'V2024_06'
          }
        }
      );
    } else {
      response = await axios.post(
        'https://api.s.unit.sh/application-forms',
        {
          data: {
            type: 'applicationForm',
            attributes: {
              idempotencyKey: `${user._id}-${Date.now()}`,
              tags: { userId: user._id.toString() },
              applicantDetails: {
                email: user.email
              },
              allowedApplicationTypes: ['Individual']
            }
          }
        },
        {
          headers: {
            'Content-Type': 'application/vnd.api+json',
            'Authorization': `Bearer ${process.env.UNIT_API_KEY}`,
            'X-Accept-Version': 'V2024_06'
          }
        }
      );
    }

    const data = response.data.data;
    console.log('Application form created:', data);

    user.unitApplicationFormId = data.id;
    user.unitApplicationFormToken = data.attributes.applicationFormToken.token;
    user.unitApplicationFormExpiration = data.attributes.applicationFormToken.expiration;
    user.unitApplicationFormUrl = data.links.related.href;
    
    await user.save();
    console.log(`User ${user.email} updated with unitApplicationFormId: ${data.id}`);

    res.json({
      id: data.id,
      token: data.attributes.applicationFormToken.token,
      expiration: data.attributes.applicationFormToken.expiration,
      url: data.links.related.href
    });
  } catch (error) {
    console.error('Application form creation error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create application form: ' + (error.response?.data?.error || error.message) });
  }
});

module.exports = router;

