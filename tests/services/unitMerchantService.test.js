const axios = require('axios');
const { createUnitApplicationForm, getUnitApplicationForm, createUnitDepositAccount } = require('../../services/unitMerchantService');

jest.mock('axios');
const mockedAxios = axios;

describe('Unit Merchant Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UNIT_API_KEY = 'test-api-key';
    process.env.UNIT_API_BASE = 'https://api.s.unit.sh';
  });

  describe('createUnitApplicationForm', () => {
    it('should create application form successfully', async () => {
      const mockResponse = {
        data: {
          data: {
            id: 'form-123',
            attributes: {
              url: 'https://example.com/form',
              token: 'form-token-123'
            },
            links: {
              self: 'https://api.s.unit.sh/application-forms/form-123'
            }
          }
        }
      };

      const mockAxiosInstance = {
        post: jest.fn().mockResolvedValue(mockResponse),
        get: jest.fn()
      };

      const { UnitMerchantService } = require('../../services/unitMerchantService');
      const service = new UnitMerchantService(mockAxiosInstance);
      
      const merchantData = {
        merchantId: 'merchant-123',
        shopifyShopId: 'test-shop'
      };

      const result = await service.createApplicationForm(merchantData);

      expect(result).toEqual({
        id: 'form-123',
        attributes: {
          url: 'https://example.com/form',
          token: 'form-token-123'
        },
        links: {
          self: 'https://api.s.unit.sh/application-forms/form-123'
        }
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/application-forms', {
        data: {
          type: 'applicationForm',
          attributes: {
            idempotencyKey: expect.stringMatching(/^merchant-merchant-123-\d+$/),
            tags: {
              merchantId: 'merchant-123',
              shopifyShopId: 'test-shop',
              source: 'shopify-stashpay'
            },
            allowedApplicationTypes: ['SingleMemberBusiness', 'MultipleMemberBusiness', 'SoleProprietorship']
          }
        }
      });
    });

    it('should handle API errors', async () => {
      const mockError = {
        response: {
          data: {
            errors: [{ title: 'Invalid request', status: '400' }]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(mockError)
      });

      const merchantData = {
        merchantId: 'merchant-123',
        shopifyShopId: 'test-shop'
      };

      await expect(createUnitApplicationForm(merchantData)).rejects.toThrow('Failed to create Unit application form');
    });

    it('should handle network errors', async () => {
      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(new Error('Network error'))
      });

      const merchantData = {
        merchantId: 'merchant-123',
        shopifyShopId: 'test-shop'
      };

      await expect(createUnitApplicationForm(merchantData)).rejects.toThrow('Failed to create Unit application form');
    });
  });

  describe('getUnitApplicationForm', () => {
    it('should fetch application form successfully', async () => {
      const mockResponse = {
        data: {
          data: {
            id: 'form-123',
            attributes: {
              url: 'https://example.com/form',
              token: 'form-token-123'
            }
          }
        }
      };

      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn().mockResolvedValue(mockResponse)
      };

      const { UnitMerchantService } = require('../../services/unitMerchantService');
      const service = new UnitMerchantService(mockAxiosInstance);

      const result = await service.getApplicationForm('form-123');

      expect(result).toEqual({
        id: 'form-123',
        attributes: {
          url: 'https://example.com/form',
          token: 'form-token-123'
        }
      });

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/application-forms/form-123');
    });

    it('should handle API errors', async () => {
      const mockError = {
        response: {
          data: {
            errors: [{ title: 'Form not found', status: '404' }]
          }
        }
      };

      const mockAxiosInstance = {
        post: jest.fn(),
        get: jest.fn().mockRejectedValue(mockError)
      };

      const { UnitMerchantService } = require('../../services/unitMerchantService');
      const service = new UnitMerchantService(mockAxiosInstance);

      await expect(service.getApplicationForm('form-123')).rejects.toThrow('Failed to fetch Unit application form');
    });
  });

  describe('createUnitDepositAccount', () => {
    it('should create deposit account successfully', async () => {
      const mockResponse = {
        data: {
          data: {
            id: 'account-123',
            attributes: {
              depositProduct: 'checking',
              status: 'Open'
            }
          }
        }
      };

      const mockAxiosInstance = {
        post: jest.fn().mockResolvedValue(mockResponse),
        get: jest.fn()
      };

      const { UnitMerchantService } = require('../../services/unitMerchantService');
      const service = new UnitMerchantService(mockAxiosInstance);
      
      const merchantData = {
        merchantId: 'merchant-123',
        unitApplicationId: 'customer-456'
      };

      const result = await service.createDepositAccount(merchantData);

      expect(result).toEqual({
        id: 'account-123',
        attributes: {
          depositProduct: 'checking',
          status: 'Open'
        }
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/accounts', {
        data: {
          type: 'depositAccount',
          attributes: {
            depositProduct: 'checking',
            tags: {
              merchantId: 'merchant-123',
              source: 'shopify-stashpay',
              accountType: 'merchant'
            }
          },
          relationships: {
            customer: {
              data: {
                type: 'customer',
                id: 'customer-456'
              }
            }
          }
        }
      });
    });

    it('should handle API errors', async () => {
      const mockError = {
        response: {
          data: {
            errors: [{ title: 'Invalid customer', status: '400' }]
          }
        }
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(mockError)
      });

      const merchantData = {
        merchantId: 'merchant-123',
        unitApplicationId: 'customer-456'
      };

      await expect(createUnitDepositAccount(merchantData)).rejects.toThrow('Failed to create Unit deposit account');
    });
  });

  describe('Service Configuration', () => {
    it('should use correct API configuration', () => {
      const UnitMerchantService = require('../../services/unitMerchantService');
      
      expect(process.env.UNIT_API_KEY).toBe('test-api-key');
      expect(process.env.UNIT_API_BASE).toBe('https://api.s.unit.sh');
    });

    it('should handle missing API key', async () => {
      delete process.env.UNIT_API_KEY;
      
      jest.resetModules();
      const { createUnitApplicationForm } = require('../../services/unitMerchantService');
      
      const merchantData = {
        merchantId: 'merchant-123',
        shopifyShopId: 'test-shop'
      };

      mockedAxios.create.mockReturnValue({
        post: jest.fn().mockRejectedValue(new Error('Cannot read properties of undefined (reading \'post\')'))
      });

      await expect(createUnitApplicationForm(merchantData)).rejects.toThrow('Failed to create Unit application form');
    });
  });
});
