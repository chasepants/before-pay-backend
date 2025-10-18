const jwt = require('jsonwebtoken');
const { verifyShopifySessionToken } = require('../../middleware/shopifyAuth');

describe('Shopify Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    // Set environment variables for testing
    process.env.SHOPIFY_CLIENT_SECRET = 'test-secret';
    process.env.SHOPIFY_API_SECRET = 'test-secret';
    
    req = {
      headers: {
        authorization: ''
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('verifyShopifySessionToken', () => {
    it('should verify valid session token', async () => {
      const validToken = jwt.sign(
        {
          iss: 'https://test-shop.myshopify.com/admin',
          dest: 'https://test-shop.myshopify.com',
          aud: 'test-audience',
          sub: '123456789',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          jti: 'test-jti',
          sid: 'test-session-id'
        },
        process.env.SHOPIFY_CLIENT_SECRET || 'test-secret'
      );

      req.headers.authorization = `Bearer ${validToken}`;

      await verifyShopifySessionToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject request without authorization header', async () => {
      await verifyShopifySessionToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'No authorization token provided' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token format', async () => {
      req.headers.authorization = 'InvalidFormat token';

      await verifyShopifySessionToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token format' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired token', async () => {
      const expiredToken = jwt.sign(
        {
          iss: 'https://test-shop.myshopify.com/admin',
          dest: 'https://test-shop.myshopify.com',
          aud: 'test-audience',
          sub: '123456789',
          exp: Math.floor(Date.now() / 1000) - 3600,
          iat: Math.floor(Date.now() / 1000) - 7200,
          jti: 'test-jti',
          sid: 'test-session-id'
        },
        process.env.SHOPIFY_CLIENT_SECRET || 'test-secret'
      );

      req.headers.authorization = `Bearer ${expiredToken}`;

      await verifyShopifySessionToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject token with invalid signature', async () => {
      const invalidToken = jwt.sign(
        {
          iss: 'https://test-shop.myshopify.com/admin',
          dest: 'https://test-shop.myshopify.com',
          aud: 'test-audience',
          sub: '123456789',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          jti: 'test-jti',
          sid: 'test-session-id'
        },
        'wrong-secret'
      );

      req.headers.authorization = `Bearer ${invalidToken}`;

      await verifyShopifySessionToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token signature' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject token with invalid issuer', async () => {
      const invalidIssuerToken = jwt.sign(
        {
          iss: 'https://malicious-site.com/admin',
          dest: 'https://test-shop.myshopify.com',
          aud: 'test-audience',
          sub: '123456789',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          jti: 'test-jti',
          sid: 'test-session-id'
        },
        process.env.SHOPIFY_CLIENT_SECRET || 'test-secret'
      );

      req.headers.authorization = `Bearer ${invalidIssuerToken}`;

      await verifyShopifySessionToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token issuer' });
      expect(next).not.toHaveBeenCalled();
    });


    it('should handle malformed JWT', async () => {
      req.headers.authorization = 'Bearer malformed.jwt.token';

      await verifyShopifySessionToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token format' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should add session data to request object', async () => {
      const validToken = jwt.sign(
        {
          iss: 'https://test-shop.myshopify.com/admin',
          dest: 'https://test-shop.myshopify.com',
          aud: 'test-audience',
          sub: '123456789',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          jti: 'test-jti',
          sid: 'test-session-id'
        },
        process.env.SHOPIFY_CLIENT_SECRET || 'test-secret'
      );

      req.headers.authorization = `Bearer ${validToken}`;

      await verifyShopifySessionToken(req, res, next);

      expect(req.shopifySession).toEqual({
        id: 'test-session-id',
        shop_id: '123456789',
        shop_domain: 'test-shop.myshopify.com',
        is_online: false,
        state: 'active'
      });
      expect(next).toHaveBeenCalled();
    });
  });
});
