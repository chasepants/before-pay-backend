const jwt = require('jsonwebtoken');
require('dotenv').config();

const verifyShopifySessionToken = async (req, res, next) => {
  try {
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

    // Add session data to request object
    req.shopifySession = {
      id: payload.sid,
      shop_id: payload.sub,
      shopDomain: payload.dest?.replace('https://', '') || payload.iss?.replace('https://', '').replace('/admin', ''),
      is_online: payload.is_online || false,
      state: payload.state || 'active'
    };

    // Call next middleware
    next();
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
