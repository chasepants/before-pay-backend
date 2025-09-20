const router = require('express').Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');
const axios = require('axios');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const firebaseService = require('../services/firebaseService');
require('dotenv').config();
const { ensureAuthenticated } = require('../middleware/auth');

router.get('/google', (req, res, next) => {
  console.log('Initiating Google OAuth from:', req.get('Referer'));
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/' }), async (req, res) => {
  console.log('Google callback triggered, req.user:', req.user);
  if (req.user) {
    let user = await User.findOne({ email: req.user.email });
    if (!user) {
      user = new User({
        email: req.user.email,
        googleId: req.user.id,
        firstName: req.user.name.givenName,
        lastName: req.user.name.familyName,
        phone: req.user.phone || '',
        status: 'pending'
      });
      await user.save();
      console.log('New user saved:', user._id, 'with googleId:', user.googleId);
    } else if (!user.googleId) {
      user.googleId = req.user.id;
      user.firstName = req.user.name.givenName;
      user.lastName = req.user.name.familyName;
      await user.save();
    } else {
      await user.save();
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '14d' });
    console.log('JWT generated:', token);
    const redirectUrl = user.status === 'approved' ? `${process.env.REACT_APP_URL}/home?token=${token}` : `${process.env.REACT_APP_URL}/application-signup?token=${token}`;
    res.redirect(redirectUrl);
  } else {
    console.error('No user in callback');
    res.redirect('/');
  }
});

router.get('/current_user', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    console.log('No token provided in /current_user');
    return res.json(null);
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    res.json(user || null);
  } catch (err) {
    console.error('Token verification error in /current_user:', err);
    res.json(null);
  }
});

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

// Email/Password Authentication Routes

/**
 * Register a new user with email and password
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

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
      status: 'pending'
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
        status: user.status
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
 * Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Note: In a real implementation, you would verify the password with Firebase
    // For now, we'll use a different approach - verify the Firebase token from the frontend
    // This endpoint will be used after the frontend authenticates with Firebase
    
    res.status(400).json({ 
      error: 'Please use the frontend Firebase authentication and then call /verify-firebase-token' 
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

/**
 * Verify Firebase ID token and create/update user session
 */
router.post('/verify-firebase-token', async (req, res) => {
  try {
    const { idToken, firstName, lastName, emailVerified } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    // Verify the Firebase ID token
    const decodedToken = await firebaseService.verifyIdToken(idToken);
    
    // Find or create user in our database
    let user = await User.findOne({ firebaseUid: decodedToken.uid });
    
    if (!user) {
      // Check if user exists by email (for Google OAuth users who want to add email/password)
      user = await User.findOne({ email: decodedToken.email });
      
      if (user) {
        // Link Firebase UID to existing user
        user.firebaseUid = decodedToken.uid;
        await user.save();
      } else {
        // Create new user
        user = new User({
          email: decodedToken.email,
          firebaseUid: decodedToken.uid,
          firstName: firstName || decodedToken.name?.split(' ')[0] || '',
          lastName: lastName || decodedToken.name?.split(' ').slice(1).join(' ') || '',
          status: emailVerified === false ? 'email_unverified' : 'pending'
        });
        await user.save();
      }
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '14d' });

    res.json({
      message: 'Authentication successful',
      token: token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Token verification error:', error);
    
    if (error.code === 'auth/invalid-token') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (error.code === 'auth/token-expired') {
      return res.status(401).json({ error: 'Token expired' });
    }

    res.status(500).json({ error: 'Token verification failed: ' + error.message });
  }
});

/**
 * Send password reset email
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user exists in our database
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Send password reset email
    const resetLink = await firebaseService.sendPasswordResetEmail(email);
    
    // In a real app, you would send this link via email
    // For now, we'll return it in the response (remove this in production)
    res.json({
      message: 'Password reset email sent',
      resetLink: resetLink // Remove this in production
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Password reset failed: ' + error.message });
  }
});

/**
 * Send email verification
 */
router.post('/send-verification', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.firebaseUid) {
      return res.status(400).json({ error: 'User not found or not using email/password auth' });
    }

    const verificationLink = await firebaseService.sendEmailVerification(user.email);
    
    res.json({
      message: 'Verification email sent',
      verificationLink: verificationLink // Remove this in production
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Email verification failed: ' + error.message });
  }
});

router.get('/logout', (req, res) => {
  res.status(200).json({ message: 'Logged out successfully' });
});

router.get('/create-application-form', ensureAuthenticated, async (req, res) => {
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

    // Store application form details in user document
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