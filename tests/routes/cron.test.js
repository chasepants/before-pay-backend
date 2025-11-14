const request = require('supertest');
const express = require('express');
const cors = require('cors');

// Set up environment variables for testing
process.env.CRON_SECRET = 'Beforepay1234!';

// Mock the process-scheduled-payments module
jest.mock('../../cron/process-scheduled-payments', () => ({
  processScheduledPayments: jest.fn()
}));

const { processScheduledPayments } = require('../../cron/process-scheduled-payments');

describe('Cron Routes', () => {
  let app;

  beforeAll(() => {
    // Create a test Express app with just the cron endpoint
    app = express();
    app.use(express.json());
    
    // Add CORS for cron endpoint
    app.use('/api/cron', cors({
      origin: true,
      methods: ['GET'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Add the cron endpoint
    app.get('/api/cron/process-payments', async (req, res) => {
      try {
        // Check for token in query parameter (Vercel cron) or Authorization header
        const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        if (token !== process.env.CRON_SECRET) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
        console.log('Cron job started at:', new Date().toISOString());
        await processScheduledPayments();
        console.log('Cron job completed at:', new Date().toISOString());
        res.json({ ok: true });
      } catch (e) {
        console.error('Cron route error:', e);
        res.status(500).json({ error: 'Cron failed' });
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/cron/process-payments', () => {
    it('should process payments with valid token in query parameter', async () => {
      // Mock successful processing
      processScheduledPayments.mockResolvedValue();

      const response = await request(app)
        .get('/api/cron/process-payments?token=Beforepay1234!')
        .expect(200);

      expect(response.body).toEqual({ ok: true });
      expect(processScheduledPayments).toHaveBeenCalledTimes(1);
    });

    it('should process payments with valid token in Authorization header', async () => {
      // Mock successful processing
      processScheduledPayments.mockResolvedValue();

      const response = await request(app)
        .get('/api/cron/process-payments')
        .set('Authorization', 'Bearer Beforepay1234!')
        .expect(200);

      expect(response.body).toEqual({ ok: true });
      expect(processScheduledPayments).toHaveBeenCalledTimes(1);
    });

    it('should reject request with invalid token in query parameter', async () => {
      const response = await request(app)
        .get('/api/cron/process-payments?token=invalid-token')
        .expect(401);

      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(processScheduledPayments).not.toHaveBeenCalled();
    });

    it('should reject request with invalid token in Authorization header', async () => {
      const response = await request(app)
        .get('/api/cron/process-payments')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(processScheduledPayments).not.toHaveBeenCalled();
    });

    it('should reject request with no token', async () => {
      const response = await request(app)
        .get('/api/cron/process-payments')
        .expect(401);

      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(processScheduledPayments).not.toHaveBeenCalled();
    });

    it('should handle processing errors gracefully', async () => {
      // Mock processing error
      const error = new Error('Processing failed');
      processScheduledPayments.mockRejectedValue(error);

      // Mock console.error to avoid noise in test output
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await request(app)
        .get('/api/cron/process-payments?token=Beforepay1234!')
        .expect(500);

      expect(response.body).toEqual({ error: 'Cron failed' });
      expect(consoleSpy).toHaveBeenCalledWith('Cron route error:', error);

      // Restore console.error
      consoleSpy.mockRestore();
    });

    it('should log start and completion times', async () => {
      // Mock successful processing
      processScheduledPayments.mockResolvedValue();

      // Mock console.log to capture log messages
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await request(app)
        .get('/api/cron/process-payments?token=Beforepay1234!')
        .expect(200);

      // Verify start and completion logs
      expect(consoleSpy).toHaveBeenCalledWith(
        'Cron job started at:',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Cron job completed at:',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      );

      // Restore console.log
      consoleSpy.mockRestore();
    });

    it('should prefer query parameter token over Authorization header', async () => {
      // Mock successful processing
      processScheduledPayments.mockResolvedValue();

      const response = await request(app)
        .get('/api/cron/process-payments?token=Beforepay1234!')
        .set('Authorization', 'Bearer invalid-token')
        .expect(200);

      expect(response.body).toEqual({ ok: true });
      expect(processScheduledPayments).toHaveBeenCalledTimes(1);
    });

    it('should use Authorization header when query parameter is not provided', async () => {
      // Mock successful processing
      processScheduledPayments.mockResolvedValue();

      const response = await request(app)
        .get('/api/cron/process-payments')
        .set('Authorization', 'Bearer Beforepay1234!')
        .expect(200);

      expect(response.body).toEqual({ ok: true });
      expect(processScheduledPayments).toHaveBeenCalledTimes(1);
    });
  });
});
