const router = require('express').Router();
const passport = require('passport');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');
const axios = require('axios');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
require('dotenv').config();

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
  console.log('Session in /current_user:', JSON.stringify(req.session, null, 2));
  console.log('User in /current_user:', req.user);
  res.json(req.user || null);
});

// auth.js (only showing /google/callback)
router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), async (req, res) => {
  console.log('Google callback triggered, req.user:', req.user);
  console.log('Session ID:', req.sessionID);
  console.log('Session before save:', JSON.stringify(req.session, null, 2));
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
      await user.save();
    }
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect('/');
      }
      console.log('Session saved, ID:', req.sessionID);
      console.log('Session after save:', JSON.stringify(req.session, null, 2));
      // Explicitly set the Set-Cookie header
      res.set('Set-Cookie', `connect.sid=${req.sessionID}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${14 * 24 * 60 * 60}`);
      console.log('Set-Cookie header set:', `connect.sid=${req.sessionID}`);
      // Send HTML for client-side redirect
      const redirectUrl = user.status === 'approved' ? `${process.env.REACT_APP_URL}/home` : `${process.env.REACT_APP_URL}/application-signup`;
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Redirecting...</title>
          <meta http-equiv="refresh" content="0; url=${redirectUrl}">
          <script>
            window.location.href = '${redirectUrl}';
          </script>
        </head>
        <body>
          Redirecting to the app... If not redirected, <a href="${redirectUrl}">click here</a>.
        </body>
        </html>
      `);
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
  console.log({
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
  })
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
    user.firstName = req.body.firstName;
    user.lastName = req.body.lastName;
    await user.save();
    console.log('Application created:', application.data.id);
    res.json({ message: 'Application submitted', applicationId: application.data.id });
  } catch (error) {
    console.error('Application error:', error.message, error.stack);
    res.status(500).json({ error: error.message });
  }
});

router.get('/documents', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.unitApplicationId) return res.status(404).json({ error: 'Application not found' });

    const response = await unit.applications.listDocuments(user.unitApplicationId);
    res.json({ documents: response.data });
  } catch (error) {
    console.error('Error fetching documents:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch documents: ' + error.message });
  }
});

router.put('/document/upload', ensureAuthenticated, upload.single('file'), async (req, res) => {
  const { applicationId, documentId } = req.body;
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.unitApplicationId || user.unitApplicationId !== applicationId || user.status !== 'awaitingDocuments') {
      return res.status(403).json({ error: 'Unauthorized or invalid status' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileType = req.file.mimetype.split('/')[1]; // e.g., 'png', 'jpeg', 'pdf'
    if (!['jpeg', 'png', 'pdf'].includes(fileType)) {
      return res.status(400).json({ error: 'Unsupported file type. Use jpeg, png, or pdf.' });
    }

    const unitApiUrl = `https://api.s.unit.sh/applications/${applicationId}/documents/${documentId}`;
    const headers = {
      'Authorization': `Bearer ${process.env.UNIT_API_KEY}`,
      'Content-Type': `image/${fileType === 'jpeg' ? 'jpeg' : fileType}` // Adjust for pdf
    };

    if (fileType === 'pdf') {
      headers['Content-Type'] = 'application/pdf';
    }

    const response = await axios.put(unitApiUrl, req.file.buffer, { headers });
    res.json({ success: true, documentId: response.data.id });
  } catch (error) {
    console.error('Error uploading document:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to upload document: ' + error.message });
  }
});

module.exports = router;
