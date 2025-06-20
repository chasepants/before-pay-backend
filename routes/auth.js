const router = require('express').Router();
const passport = require('passport');
const User = require('../models/User');

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/current_user', (req, res) => {
  res.json(req.user || null);
});

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
  res.redirect('http://localhost:3000/home');
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
    console.log(req)
    const user = await User.findById(req.user._id);
    console.log(user)
    const completed = user.address?.line1 && user.ssnLast4 && user.dateOfBirth;
    console.log(completed);
    res.json({ completed });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check profile status' });
  }
});

module.exports = router;