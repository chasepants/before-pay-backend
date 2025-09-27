const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

/**
 * Middleware to verify Shopify session tokens
 * This ensures requests are coming from authenticated Shopify admin users
 */
const verifyShopifySessionToken = async (req, res, next) => {
  try {
    // Get the Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ 
        error: 'No authorization token provided'
      });
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Invalid token format'
      });
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Invalid token format'
      });
    }

    const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
    
    if (!SHOPIFY_CLIENT_SECRET) {
      console.error('SHOPIFY_CLIENT_SECRET environment variable not set');
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'Shopify API secret not configured'
      });
    }

    const payload = jwt.verify(token, SHOPIFY_CLIENT_SECRET, { 
      algorithms: ['HS256'] 
    });

    if (!payload.iss || !payload.iss.includes('.myshopify.com/admin')) {
      return res.status(401).json({ 
        error: 'Invalid token issuer'
      });
    }

    const shopInfo = {
      shop: payload.dest,
      shopId: payload.dest?.replace('.myshopify.com', ''),
      userId: payload.sub,
      sessionId: payload.sid,
      iat: payload.iat,
      exp: payload.exp,
      iss: payload.iss,
      aud: payload.aud,
    };
    
    req.shopify = shopInfo;

    try {
      const shopDomain = payload.dest.replace('https://', '').replace('http://', '');
      const sessionResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/sessions/${payload.sid}.json`, {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN || 'test-token'
        }
      });

      req.shopifySession = sessionResponse.data.session;

      console.log(`Authenticated request from shop: ${shopInfo.shop}, user: ${shopInfo.userId}`);
      
      next();
    } catch (apiError) {
      console.error('Failed to fetch session data from Shopify:', apiError.message);
      return res.status(401).json({ 
        error: 'Failed to verify session with Shopify'
      });
    }
    
  } catch (error) {
    console.error('Session token verification failed:', error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      if (error.message.includes('malformed') || error.message.includes('Invalid token') || error.message === 'invalid token') {
        return res.status(401).json({ 
          error: 'Invalid token format'
        });
      }
      return res.status(401).json({ 
        error: 'Invalid token signature'
      });
    }
    
    return res.status(401).json({ 
      error: 'Invalid token format'
    });
  }
};

module.exports = { verifyShopifySessionToken };
