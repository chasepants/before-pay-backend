// backend/config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
require('dotenv').config();

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.APP_URL}/api/auth/google/callback`
},
async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ email: profile.emails[0].value });
    if (!user) {
      user = new User({
        email: profile.emails[0].value,
        googleId: profile.id, // Set Google sub as googleId
        status: 'pending'
      });
      await user.save();
    } else if (!user.googleId) {
      user.googleId = profile.id;
      await user.save();
    }
    return done(null, user);
  } catch (err) {
    console.log(err)
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, {
    _id: user._id,
    email: user.email,
    googleId: user.googleId,
    unitAccountId: user.unitAccountId,
    status: user.status,
    firstName: user.firstName,
    lastName: user.lastName,
    unitCustomerId: user.unitCustomerId,
    unitApplicationId: user.unitApplicationId,
    address: user.address,
    ssnLast4: user.ssnLast4,
    dateOfBirth: user.dateOfBirth,
    plaidAccessToken: user.plaidAccessToken,
    phone: user.phone,
    sourceOfIncome: user.sourceOfIncome,
    annualIncome: user.annualIncome,
    occupation: user.occupation
  });
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    console.log(err)
    done(err);
  }
});

module.exports = passport;