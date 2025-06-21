// backend/routes/auth.js
const router = require('express').Router();
const passport = require('passport');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Unauthorized' });
};

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

router.get('/google', (req, res, next) => {
  console.log('Initiating Google OAuth from:', req.get('Referer'));
  passport.authenticate('google', { scope: ['profile', 'email'], session: true })(req, res, next);
});

router.get('/current_user', (req, res) => {
  res.json(req.user || null);
});

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), async (req, res) => {
  console.log('Google callback triggered, req.user:', req.user);
  console.log('Session:', req.session);
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
      try {
        await user.save();
        console.log('New user saved:', user._id, 'with googleId:', user.googleId);
      } catch (error) {
        console.error('User save error:', error);
        return res.redirect('/');
      }
    } else if (!user.googleId) {
      user.googleId = req.user.id;
      await user.save();
    }
    req.session.save(() => {
      if (user.status === 'approved') {
        res.redirect('http://localhost:3000/home');
      } else {
        res.redirect('http://localhost:3000/application-signup');
      }
    });
  } else {
    console.error('No user in callback, session issue?');
    res.redirect('/');
  }
});

router.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
        return res.status(500).json({ message: 'Logout failed' });
      }
      res.clearCookie('connect.sid', { path: '/' });
      res.status(200).json({ message: 'Logged out successfully' });
    });
  });
});

router.post('/complete-profile', ensureAuthenticated, async (req, res) => {
  const { address, ssnLast4, dateOfBirth } = req.body;
  try {
    if (!address || !ssnLast4 || !dateOfBirth) {
      return res.status(400).json({ error: 'Address and SSN last 4 required' });
    }
    const user = await User.findById(req.user._id);
    user.address = address;
    user.ssnLast4 = ssnLast4;
    user.dateOfBirth = dateOfBirth;
    await user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

router.get('/profile-status', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const completed = user.address?.line1 && user.ssnLast4 && user.dateOfBirth;
    res.json({ completed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check profile status' });
  }
});

router.post('/application', ensureAuthenticated, async (req, res) => {
  console.log('Application request received:', req.body);
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const application = await unit.applications.create({
      type: 'individualApplication',
      attributes: {
        ssn: req.body.ssn,
        fullName: {
          first: req.body.firstName,
          last: req.body.lastName
        },
        dateOfBirth: req.body.dateOfBirth,
        address: {
          street: req.body.addressLine1,
          city: req.body.city,
          state: req.body.state,
          postalCode: req.body.postalCode,
          country: req.body.country
        },
        email: req.body.email || user.email,
        phone: { number: req.body.phone || user.phone || '1234567890', countryCode: '1' },
        ip: '127.0.0.1',
        sourceOfIncome: req.body.sourceOfIncome || null,
        annualIncome: req.body.annualIncome || null,
        occupation: "ArchitectOrEngineer",
        idempotencyKey: `${user.email}-${Date.now()}`,
        tags: {
          userId: req.user._id
        }
      },
    });
    user.unitApplicationId = application.data.id;
    user.ssnLast4 = req.body.ssn.slice(-4);
    user.dateOfBirth = new Date(req.body.dateOfBirth);
    user.address = {
      line1: req.body.addressLine1,
      city: req.body.city,
      state: req.body.state,
      postalCode: req.body.postalCode
    };
    user.sourceOfIncome = req.body.sourceOfIncome;
    user.annualIncome = req.body.annualIncome;
    user.occupation = req.body.occupation;
    await user.save();
    console.log('Application created:', application.data.id);
    res.json({ message: 'Application submitted', applicationId: application.data.id });
  } catch (error) {
    console.error('Application error:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;