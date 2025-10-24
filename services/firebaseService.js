const admin = require('firebase-admin');
require('dotenv').config();

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  };

  // Validate required fields
  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    console.warn('Firebase credentials not fully configured. Some features may not work.');
  } else {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
}

const auth = admin.auth();

/**
 * Create a new user with email and password
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @returns {Object} User record from Firebase
 */
async function createUserWithEmailAndPassword(email, password, firstName, lastName) {
  try {
    const userRecord = await auth.createUser({
      email: email,
      password: password,
      displayName: `${firstName} ${lastName}`,
      emailVerified: false, // You can set this to true if you want to skip email verification
    });

    // Send email verification
    await auth.generateEmailVerificationLink(email);
    
    return userRecord;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
}

/**
 * Verify a Firebase ID token
 * @param {string} idToken - Firebase ID token
 * @returns {Object} Decoded token with user info
 */
async function verifyIdToken(idToken) {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying token:', error);
    throw error;
  }
}

/**
 * Get user by email
 * @param {string} email - User's email
 * @returns {Object} User record from Firebase
 */
async function getUserByEmail(email) {
  try {
    const userRecord = await auth.getUserByEmail(email);
    return userRecord;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return null;
    }
    console.error('Error getting user by email:', error);
    throw error;
  }
}

/**
 * Update user profile
 * @param {string} uid - Firebase user ID
 * @param {Object} updates - Updates to apply
 * @returns {Object} Updated user record
 */
async function updateUser(uid, updates) {
  try {
    const userRecord = await auth.updateUser(uid, updates);
    return userRecord;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

/**
 * Delete a user
 * @param {string} uid - Firebase user ID
 */
async function deleteUser(uid) {
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
}

/**
 * Send password reset email
 * @param {string} email - User's email
 * @returns {string} Password reset link
 */
async function sendPasswordResetEmail(email) {
  try {
    const link = await auth.generatePasswordResetLink(email);
    return link;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error;
  }
}

/**
 * Send email verification
 * @param {string} email - User's email
 * @returns {string} Email verification link
 */
async function sendEmailVerification(email) {
  try {
    const link = await auth.generateEmailVerificationLink(email);
    return link;
  } catch (error) {
    console.error('Error sending email verification:', error);
    throw error;
  }
}

async function createCustomToken(uid, additionalClaims = {}) {
  return await auth.createCustomToken(uid, additionalClaims);
}

module.exports = {
  createUserWithEmailAndPassword,
  verifyIdToken,
  getUserByEmail,
  updateUser,
  deleteUser,
  sendPasswordResetEmail,
  sendEmailVerification,
  createCustomToken,
};
