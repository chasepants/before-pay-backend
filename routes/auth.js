const router = require('express').Router();
const passport = require('passport');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { Unit } = require('@unit-finance/unit-node-sdk');
const unit = new Unit(process.env.UNIT_API_KEY, 'https://api.s.unit.sh');
const axios = require('axios');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
require('dotenv').config();

const ensureAuthenticated = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized: User not found' });
    req.user = user;
    next();
  } catch (err) {
    console.error('Token verification error:', err);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

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

router.get('/logout', (req, res) => {
  res.status(200).json({ message: 'Logged out successfully' });
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

router.get('/create-application-form', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // if (user.unitApplicationFormId && user.unitApplicationFormExpiration) {
    //   const expirationDate = new Date(user.unitApplicationFormExpiration);
    //   if (expirationDate > new Date()) {
    //     console.log(`Using cached application form for user ${user.email}:`, user.unitApplicationFormId);
    //     return res.json({
    //       id: user.unitApplicationFormId,
    //       token: user.unitApplicationFormToken,
    //       expiration: user.unitApplicationFormExpiration,
    //       url: user.unitApplicationFormUrl
    //     });
    //   }
    // }  

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
    const fileType = req.file.mimetype.split('/')[1];
    if (!['jpeg', 'png', 'pdf'].includes(fileType)) {
      return res.status(400).json({ error: 'Unsupported file type. Use jpeg, png, or pdf.' });
    }
    const unitApiUrl = `https://api.s.unit.sh/applications/${applicationId}/documents/${documentId}`;
    const headers = {
      'Authorization': `Bearer ${process.env.UNIT_API_KEY}`,
      'Content-Type': `image/${fileType === 'jpeg' ? 'jpeg' : fileType}`
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