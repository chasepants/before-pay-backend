const jwt = require('jsonwebtoken');
require('dotenv').config();

/**
 * Middleware to verify Shopify session tokens
 * This ensures requests are coming from authenticated Shopify admin users
 */
const verifyShopifySessionToken = (req, res, next) => {
  try {
    // Get the Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Missing or invalid authorization header',
        message: 'Session token required'
      });
    }
    
    // Extract the token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!token) {
      return res.status(401).json({ 
        error: 'No session token provided',
        message: 'Session token required'
      });
    }
    
    // Verify the token using your Shopify app secret
    const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
    
    if (!SHOPIFY_CLIENT_SECRET) {
      console.error('SHOPIFY_CLIENT_SECRET environment variable not set');
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'Shopify API secret not configured'
      });
    }
    
    // Verify the JWT token
    const payload = jwt.verify(token, SHOPIFY_CLIENT_SECRET, { 
      algorithms: ['HS256'] 
    });
    
    // Extract shop and user information from the token
    const shopInfo = {
      shop: payload.dest, // The shop domain (e.g., "mystore.myshopify.com")
      shopId: payload.dest?.replace('.myshopify.com', ''), // Extract shop ID
      userId: payload.sub, // The admin user ID
      sessionId: payload.sid, // The session ID
      iat: payload.iat, // Issued at timestamp
      exp: payload.exp, // Expiration timestamp
      iss: payload.iss, // Issuer (Shopify)
      aud: payload.aud, // Audience (your app)
    };
    
    // Add shop info to the request object
    req.shopify = shopInfo;
    
    // Log the authenticated request (optional, for debugging)
    console.log(`Authenticated request from shop: ${shopInfo.shop}, user: ${shopInfo.userId}`);
    
    next();
    
  } catch (error) {
    console.error('Session token verification failed:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Session token expired',
        message: 'Please refresh the page and try again'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid session token',
        message: 'Authentication failed'
      });
    }
    
    return res.status(401).json({ 
      error: 'Token verification failed',
      message: 'Invalid or malformed session token'
    });
  }
};

module.exports = { verifyShopifySessionToken };
