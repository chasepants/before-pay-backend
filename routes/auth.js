const router = require('express').Router();
const passport = require('passport');

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/current_user', (req, res) => {
  console.log('Session:', req.session);
  console.log('User:', req.user);
  res.json(req.user || null);
});

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
  console.log('Callback success - Session:', req.session);
  console.log('Callback success - User:', req.user);
  res.redirect('http://localhost:3000/home');
});

router.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

module.exports = router;