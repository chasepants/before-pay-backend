const PlaidService = require('../../services/plaidService');

// Mock the plaid module
jest.mock('plaid', () => ({
  Configuration: jest.fn(),
  PlaidApi: jest.fn()
}));

describe('PlaidService', () => {
  let plaidService;
  let mockPlaidClient;

  beforeEach(() => {
    process.env.PLAID_CLIENT_ID = 'test_client_id';
    process.env.PLAID_SECRET = 'test_secret';
    process.env.PLAID_ENV = 'sandbox';

    mockPlaidClient = {
      linkTokenCreate: jest.fn(),
      itemPublicTokenExchange: jest.fn(),
      processorTokenCreate: jest.fn(),
      accountsGet: jest.fn(),
      accountsBalanceGet: jest.fn(),
      transactionsGet: jest.fn(),
      itemGet: jest.fn(),
      itemAccessTokenInvalidate: jest.fn(),
      institutionsGetById: jest.fn(),
      institutionsSearch: jest.fn(),
      webhookVerificationKeyGet: jest.fn(),
      sandboxPublicTokenCreate: jest.fn()
    };

    const { PlaidApi } = require('plaid');
    PlaidApi.mockImplementation(() => mockPlaidClient);

    plaidService = new PlaidService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      const { Configuration, PlaidApi } = require('plaid');
      
      expect(Configuration).toHaveBeenCalledWith({
        basePath: 'https://sandbox.plaid.com',
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': 'test_client_id',
            'PLAID-SECRET': 'test_secret',
          },
        },
      });
      expect(PlaidApi).toHaveBeenCalled();
    });
  });

  describe('getBasePath', () => {
    it('should return sandbox URL for sandbox environment', () => {
      process.env.PLAID_ENV = 'sandbox';
      const newService = new PlaidService();
      expect(newService.getBasePath()).toBe('https://sandbox.plaid.com');
    });

    // it('should return development URL for development environment', () => {
    //   process.env.PLAID_ENV = 'development';
    //   const newService = new PlaidService();
    //   expect(newService.getBasePath()).toBe('https://development.plaid.com');
    // });

    // it('should return production URL for production environment', () => {
    //   process.env.PLAID_ENV = 'production';
    //   const newService = new PlaidService();
    //   expect(newService.getBasePath()).toBe('https://production.plaid.com');
    // });

    it('should default to sandbox for unknown environment', () => {
      process.env.PLAID_ENV = 'unknown';
      const newService = new PlaidService();
      expect(newService.getBasePath()).toBe('https://sandbox.plaid.com');
    });
  });

  describe('createLinkToken', () => {
    // it('should create link token successfully', async () => {
    //   const mockResponse = {
    //     data: {
    //       link_token: 'test_link_token',
    //       expiration: '2023-12-31T23:59:59Z'
    //     }
    //   };
    //   mockPlaidClient.linkTokenCreate.mockResolvedValue(mockResponse);

    //   const result = await plaidService.createLinkToken('user123', 'Test App');

    //   expect(mockPlaidClient.linkTokenCreate).toHaveBeenCalledWith({
    //     user: { client_user_id: 'user123' },
    //     client_name: 'Test App',
    //     country_codes: ['US'],
    //     language: 'en',
    //     products: ['auth', 'transactions'],
    //     account_filters: {
    //       depository: {
    //         account_subtypes: ['checking', 'savings']
    //       }
    //     }
    //   });
    //   expect(result).toEqual(mockResponse);
    // });

    // it('should throw error when link token creation fails', async () => {
    //   const error = new Error('API Error');
    //   mockPlaidClient.linkTokenCreate.mockRejectedValue(error);

    //   await expect(plaidService.createLinkToken('user123')).rejects.toThrow('Failed to create link token: API Error');
    // });
  });

  describe('exchangePublicToken', () => {
    it('should exchange public token successfully', async () => {
      const mockResponse = {
        data: {
          access_token: 'test_access_token',
          item_id: 'test_item_id'
        }
      };
      mockPlaidClient.itemPublicTokenExchange.mockResolvedValue(mockResponse);

      const result = await plaidService.exchangePublicToken('test_public_token');

      expect(mockPlaidClient.itemPublicTokenExchange).toHaveBeenCalledWith({
        public_token: 'test_public_token'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when token exchange fails', async () => {
      const error = new Error('Exchange Error');
      mockPlaidClient.itemPublicTokenExchange.mockRejectedValue(error);

      await expect(plaidService.exchangePublicToken('invalid_token')).rejects.toThrow('Failed to exchange public token: Exchange Error');
    });
  });

  describe('createProcessorToken', () => {
    it('should create processor token successfully', async () => {
      const mockResponse = {
        data: {
          processor_token: 'test_processor_token'
        }
      };
      mockPlaidClient.processorTokenCreate.mockResolvedValue(mockResponse);

      const result = await plaidService.createProcessorToken('access_token', 'account_id', 'unit');

      expect(mockPlaidClient.processorTokenCreate).toHaveBeenCalledWith({
        access_token: 'access_token',
        account_id: 'account_id',
        processor: 'unit'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when processor token creation fails', async () => {
      const error = new Error('Processor Error');
      mockPlaidClient.processorTokenCreate.mockRejectedValue(error);

      await expect(plaidService.createProcessorToken('access_token', 'account_id')).rejects.toThrow('Failed to create processor token: Processor Error');
    });
  });

  describe('getAccounts', () => {
    it('should get accounts successfully', async () => {
      const mockResponse = {
        data: {
          accounts: [
            { account_id: 'acc1', name: 'Checking' },
            { account_id: 'acc2', name: 'Savings' }
          ]
        }
      };
      mockPlaidClient.accountsGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getAccounts('access_token');

      expect(mockPlaidClient.accountsGet).toHaveBeenCalledWith({
        access_token: 'access_token'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting accounts fails', async () => {
      const error = new Error('Accounts Error');
      mockPlaidClient.accountsGet.mockRejectedValue(error);

      await expect(plaidService.getAccounts('access_token')).rejects.toThrow('Failed to get accounts: Accounts Error');
    });
  });

  describe('getAccountBalance', () => {
    it('should get account balance without account IDs', async () => {
      const mockResponse = {
        data: {
          accounts: [
            { account_id: 'acc1', balances: { current: 1000 } }
          ]
        }
      };
      mockPlaidClient.accountsBalanceGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getAccountBalance('access_token');

      expect(mockPlaidClient.accountsBalanceGet).toHaveBeenCalledWith({
        access_token: 'access_token'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should get account balance with specific account IDs', async () => {
      const mockResponse = {
        data: {
          accounts: [
            { account_id: 'acc1', balances: { current: 1000 } }
          ]
        }
      };
      mockPlaidClient.accountsBalanceGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getAccountBalance('access_token', ['acc1', 'acc2']);

      expect(mockPlaidClient.accountsBalanceGet).toHaveBeenCalledWith({
        access_token: 'access_token',
        account_ids: ['acc1', 'acc2']
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting balance fails', async () => {
      const error = new Error('Balance Error');
      mockPlaidClient.accountsBalanceGet.mockRejectedValue(error);

      await expect(plaidService.getAccountBalance('access_token')).rejects.toThrow('Failed to get account balance: Balance Error');
    });
  });

  describe('getTransactions', () => {
    it('should get transactions without account IDs', async () => {
      const mockResponse = {
        data: {
          transactions: [
            { transaction_id: 'tx1', amount: 100 }
          ]
        }
      };
      mockPlaidClient.transactionsGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getTransactions('access_token', '2023-01-01', '2023-01-31');

      expect(mockPlaidClient.transactionsGet).toHaveBeenCalledWith({
        access_token: 'access_token',
        start_date: '2023-01-01',
        end_date: '2023-01-31',
        options: {
          count: 100,
          offset: 0
        }
      });
      expect(result).toEqual(mockResponse);
    });

    it('should get transactions with specific account IDs', async () => {
      const mockResponse = {
        data: {
          transactions: [
            { transaction_id: 'tx1', amount: 100 }
          ]
        }
      };
      mockPlaidClient.transactionsGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getTransactions('access_token', '2023-01-01', '2023-01-31', ['acc1']);

      expect(mockPlaidClient.transactionsGet).toHaveBeenCalledWith({
        access_token: 'access_token',
        start_date: '2023-01-01',
        end_date: '2023-01-31',
        options: {
          count: 100,
          offset: 0
        },
        account_ids: ['acc1']
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting transactions fails', async () => {
      const error = new Error('Transactions Error');
      mockPlaidClient.transactionsGet.mockRejectedValue(error);

      await expect(plaidService.getTransactions('access_token', '2023-01-01', '2023-01-31')).rejects.toThrow('Failed to get transactions: Transactions Error');
    });
  });

  describe('getItem', () => {
    it('should get item successfully', async () => {
      const mockResponse = {
        data: {
          item: { item_id: 'item1', institution_id: 'ins1' }
        }
      };
      mockPlaidClient.itemGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getItem('access_token');

      expect(mockPlaidClient.itemGet).toHaveBeenCalledWith({
        access_token: 'access_token'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting item fails', async () => {
      const error = new Error('Item Error');
      mockPlaidClient.itemGet.mockRejectedValue(error);

      await expect(plaidService.getItem('access_token')).rejects.toThrow('Failed to get item: Item Error');
    });
  });

  describe('invalidateAccessToken', () => {
    it('should invalidate access token successfully', async () => {
      const mockResponse = {
        data: {
          new_access_token: 'new_access_token'
        }
      };
      mockPlaidClient.itemAccessTokenInvalidate.mockResolvedValue(mockResponse);

      const result = await plaidService.invalidateAccessToken('access_token');

      expect(mockPlaidClient.itemAccessTokenInvalidate).toHaveBeenCalledWith({
        access_token: 'access_token'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when invalidating token fails', async () => {
      const error = new Error('Invalidate Error');
      mockPlaidClient.itemAccessTokenInvalidate.mockRejectedValue(error);

      await expect(plaidService.invalidateAccessToken('access_token')).rejects.toThrow('Failed to invalidate access token: Invalidate Error');
    });
  });

  describe('getInstitution', () => {
    it('should get institution successfully', async () => {
      const mockResponse = {
        data: {
          institution: { institution_id: 'ins1', name: 'Test Bank' }
        }
      };
      mockPlaidClient.institutionsGetById.mockResolvedValue(mockResponse);

      const result = await plaidService.getInstitution('ins1', ['US']);

      expect(mockPlaidClient.institutionsGetById).toHaveBeenCalledWith({
        institution_id: 'ins1',
        country_codes: ['US'],
        options: {
          include_optional_metadata: true
        }
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting institution fails', async () => {
      const error = new Error('Institution Error');
      mockPlaidClient.institutionsGetById.mockRejectedValue(error);

      await expect(plaidService.getInstitution('ins1')).rejects.toThrow('Failed to get institution: Institution Error');
    });
  });

  describe('searchInstitutions', () => {
    it('should search institutions successfully', async () => {
      const mockResponse = {
        data: {
          institutions: [
            { institution_id: 'ins1', name: 'Test Bank' }
          ]
        }
      };
      mockPlaidClient.institutionsSearch.mockResolvedValue(mockResponse);

      const result = await plaidService.searchInstitutions('test bank', ['auth'], ['US']);

      expect(mockPlaidClient.institutionsSearch).toHaveBeenCalledWith({
        query: 'test bank',
        products: ['auth'],
        country_codes: ['US'],
        options: {
          include_optional_metadata: true
        }
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when searching institutions fails', async () => {
      const error = new Error('Search Error');
      mockPlaidClient.institutionsSearch.mockRejectedValue(error);

      await expect(plaidService.searchInstitutions('test')).rejects.toThrow('Failed to search institutions: Search Error');
    });
  });

  describe('getWebhookVerificationKey', () => {
    it('should get webhook verification key successfully', async () => {
      const mockResponse = {
        data: {
          key: { key_id: 'key1', key: 'test_key' }
        }
      };
      mockPlaidClient.webhookVerificationKeyGet.mockResolvedValue(mockResponse);

      const result = await plaidService.getWebhookVerificationKey('key1');

      expect(mockPlaidClient.webhookVerificationKeyGet).toHaveBeenCalledWith({
        key_id: 'key1'
      });
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting webhook key fails', async () => {
      const error = new Error('Webhook Key Error');
      mockPlaidClient.webhookVerificationKeyGet.mockRejectedValue(error);

      await expect(plaidService.getWebhookVerificationKey('key1')).rejects.toThrow('Failed to get webhook verification key: Webhook Key Error');
    });
  });
});
