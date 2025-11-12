const router = require('express').Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
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
        status: 'pending',
        userType: 'savings-account' // Google OAuth users are savings account users. This is not supported for guest users as of now.
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
    console.log('JWT generated for Google OAuth user:', token);
    const redirectUrl = user.status === 'approved' ? `${process.env.REACT_APP_URL}/home?token=${token}` : `${process.env.REACT_APP_URL}/application-signup?token=${token}`;
    res.redirect(redirectUrl);
  } else {
    console.error('No user in callback');
    res.redirect('/');
  }
});

// Email/Password Authentication Routes

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    res.status(400).json({ 
      error: 'Please use the frontend Firebase authentication and then call /verify-firebase-token' 
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

router.post('/verify-firebase-token', async (req, res) => {
  try {
    const { idToken, firstName, lastName, emailVerified, userType } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token is required' });
    }

    const decodedToken = await firebaseService.verifyIdToken(idToken);
    
    let user = await User.findOne({ firebaseUid: decodedToken.uid });
    
    if (!user) {
      user = await User.findOne({ email: decodedToken.email });
      
      if (user) {
        user.firebaseUid = decodedToken.uid;
        await user.save();
      } else {
        user = new User({
          email: decodedToken.email,
          firebaseUid: decodedToken.uid,
          firstName: firstName || decodedToken.name?.split(' ')[0] || '',
          lastName: lastName || decodedToken.name?.split(' ').slice(1).join(' ') || '',
          status: emailVerified === false ? 'email_unverified' : 'pending',
          userType: userType || 'savings-account' // Default to savings-account if not specified
        });
        await user.save();
      }
    }

    // Generate JWT token (consistent with other auth flows)
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '14d' });

    res.json({
      message: 'Authentication successful',
      token: token, // Return JWT token instead of Firebase ID token
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
        userType: user.userType,
        unitCustomerId: user.unitCustomerId,
        unitAccountId: user.unitAccountId,
        unitApplicationId: user.unitApplicationId
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

    const resetLink = await firebaseService.sendPasswordResetEmail(email);
    
    res.json({
      message: 'Password reset email sent',
      resetLink: resetLink
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Password reset failed: ' + error.message });
  }
});

router.post('/send-verification', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.firebaseUid) {
      return res.status(400).json({ error: 'User not found or not using email/password auth' });
    }

    const verificationLink = await firebaseService.sendEmailVerification(user.email);
    
    res.json({
      message: 'Verification email sent',
      verificationLink: verificationLink
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Email verification failed: ' + error.message });
  }
});

router.get('/logout', (req, res) => {
  res.status(200).json({ message: 'Logged out successfully' });
});

// Email verification routes for guest users
const emailService = require('../services/emailService');
const VerificationCode = require('../models/VerificationCode');
const GuestSession = require('../models/GuestSession');

/**
 * Send email verification code
 * POST /api/auth/verification/send
 */
router.post('/verification/send', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await VerificationCode.deleteMany({ email });

    await new VerificationCode({
      email,
      code: verificationCode,
      expiresAt
    }).save();

    const emailResult = await emailService.sendVerificationCode(email, verificationCode);
    
    if (!emailResult.success) {
      console.error('Failed to send verification email:', emailResult.error);
    } else {
      console.log('Verification email sent successfully:', emailResult.messageId);
    }
    
    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email'
    });
  } catch (error) {
    console.error('Error sending verification code:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/**
 * Verify email code and create guest session
 * POST /api/auth/verification/verify
 */
router.post('/verification/verify', async (req, res) => {
  try {
    const { email, verificationCode } = req.body;
    
    if (!email || !verificationCode) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    
    const storedCode = await VerificationCode.findOne({ email, code: verificationCode });
    if (!storedCode) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    
    await VerificationCode.deleteOne({ _id: storedCode._id });
    
    const guestToken = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    
    await new GuestSession({
      email,
      guestToken,
      expiresAt
    }).save();
    
    res.status(200).json({
      success: true,
      guestToken,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Error verifying code:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});



module.exports = router;