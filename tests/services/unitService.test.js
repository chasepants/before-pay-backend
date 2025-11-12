// Mock Unit SDK
const mockUnitInstance = {
  applications: {
    create: jest.fn(),
    get: jest.fn()
  },
  accounts: {
    create: jest.fn(),
    get: jest.fn()
  },
  payments: {
    create: jest.fn()
  },
  transfers: {
    create: jest.fn()
  },
  customers: {
    get: jest.fn()
  }
};

jest.mock('@unit-finance/unit-node-sdk', () => ({
  Unit: jest.fn().mockImplementation(() => mockUnitInstance)
}));

const UnitService = require('../../services/unitService');

describe('UnitService', () => {
  const originalEnv = process.env.UNIT_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.UNIT_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env.UNIT_API_KEY = originalEnv;
  });

  describe('constructor', () => {
    it('should throw error when UNIT_API_KEY is not set', () => {
      delete process.env.UNIT_API_KEY;
      expect(() => new UnitService()).toThrow('UNIT_API_KEY environment variable is required but not set');
    });

    it('should create Unit SDK instance when UNIT_API_KEY is set', () => {
      const { Unit } = require('@unit-finance/unit-node-sdk');
      const service = new UnitService();
      expect(Unit).toHaveBeenCalledWith('test-api-key', 'https://api.s.unit.sh');
      expect(service.unit).toBe(mockUnitInstance);
    });
  });

  describe('createApplication', () => {
    it('should successfully create an application', async () => {
      const service = new UnitService();
      const applicationData = { type: 'individualApplication' };
      const mockResponse = {
        data: {
          id: 'app-123',
          attributes: { status: 'pending' }
        }
      };

      mockUnitInstance.applications.create.mockResolvedValue(mockResponse);

      const result = await service.createApplication(applicationData);

      expect(mockUnitInstance.applications.create).toHaveBeenCalledWith(applicationData);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when application creation fails', async () => {
      const service = new UnitService();
      const applicationData = { type: 'individualApplication' };
      const mockError = new Error('API error');

      mockUnitInstance.applications.create.mockRejectedValue(mockError);

      await expect(service.createApplication(applicationData)).rejects.toThrow('Failed to create application: API error');
      expect(mockUnitInstance.applications.create).toHaveBeenCalledWith(applicationData);
    });
  });

  describe('getApplication', () => {
    it('should successfully get an application', async () => {
      const service = new UnitService();
      const applicationId = 'app-123';
      const mockResponse = {
        data: {
          id: 'app-123',
          attributes: { status: 'approved' }
        }
      };

      mockUnitInstance.applications.get.mockResolvedValue(mockResponse);

      const result = await service.getApplication(applicationId);

      expect(mockUnitInstance.applications.get).toHaveBeenCalledWith(applicationId);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting application fails', async () => {
      const service = new UnitService();
      const applicationId = 'app-123';
      const mockError = new Error('Application not found');

      mockUnitInstance.applications.get.mockRejectedValue(mockError);

      await expect(service.getApplication(applicationId)).rejects.toThrow('Failed to get application: Application not found');
      expect(mockUnitInstance.applications.get).toHaveBeenCalledWith(applicationId);
    });
  });

  describe('createAccount', () => {
    it('should successfully create an account', async () => {
      const service = new UnitService();
      const accountData = { type: 'depositAccount', attributes: { depositProduct: 'checking' } };
      const mockResponse = {
        data: {
          id: 'account-123',
          attributes: { status: 'open' }
        }
      };

      mockUnitInstance.accounts.create.mockResolvedValue(mockResponse);

      const result = await service.createAccount(accountData);

      expect(mockUnitInstance.accounts.create).toHaveBeenCalledWith(accountData);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when account creation fails', async () => {
      const service = new UnitService();
      const accountData = { type: 'depositAccount' };
      const mockError = new Error('Invalid account data');

      mockUnitInstance.accounts.create.mockRejectedValue(mockError);

      await expect(service.createAccount(accountData)).rejects.toThrow('Failed to create account: Invalid account data');
      expect(mockUnitInstance.accounts.create).toHaveBeenCalledWith(accountData);
    });
  });

  describe('getAccount', () => {
    it('should successfully get an account', async () => {
      const service = new UnitService();
      const accountId = 'account-123';
      const mockResponse = {
        data: {
          id: 'account-123',
          attributes: { status: 'open', balance: 1000 }
        }
      };

      mockUnitInstance.accounts.get.mockResolvedValue(mockResponse);

      const result = await service.getAccount(accountId);

      expect(mockUnitInstance.accounts.get).toHaveBeenCalledWith(accountId);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting account fails', async () => {
      const service = new UnitService();
      const accountId = 'account-123';
      const mockError = new Error('Account not found');

      mockUnitInstance.accounts.get.mockRejectedValue(mockError);

      await expect(service.getAccount(accountId)).rejects.toThrow('Failed to get account: Account not found');
      expect(mockUnitInstance.accounts.get).toHaveBeenCalledWith(accountId);
    });
  });

  describe('createPayment', () => {
    it('should successfully create a payment', async () => {
      const service = new UnitService();
      const paymentData = {
        type: 'achPayment',
        attributes: {
          amount: 10000,
          direction: 'Debit'
        }
      };
      const mockResponse = {
        data: {
          id: 'payment-123',
          attributes: {
            amount: 10000,
            direction: 'Debit',
            status: 'pending'
          }
        }
      };

      mockUnitInstance.payments.create.mockResolvedValue(mockResponse);

      const result = await service.createPayment(paymentData);

      expect(mockUnitInstance.payments.create).toHaveBeenCalledWith(paymentData);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when payment creation fails', async () => {
      const service = new UnitService();
      const paymentData = { type: 'achPayment' };
      const mockError = new Error('Insufficient funds');

      mockUnitInstance.payments.create.mockRejectedValue(mockError);

      await expect(service.createPayment(paymentData)).rejects.toThrow('Failed to create payment: Insufficient funds');
      expect(mockUnitInstance.payments.create).toHaveBeenCalledWith(paymentData);
    });
  });

  describe('createTransfer', () => {
    it('should successfully create a transfer', async () => {
      const service = new UnitService();
      const transferData = {
        type: 'achTransfer',
        attributes: {
          amount: 5000,
          direction: 'Credit'
        }
      };
      const mockResponse = {
        data: {
          id: 'transfer-123',
          attributes: {
            amount: 5000,
            direction: 'Credit',
            status: 'pending'
          }
        }
      };

      mockUnitInstance.transfers.create.mockResolvedValue(mockResponse);

      const result = await service.createTransfer(transferData);

      expect(mockUnitInstance.transfers.create).toHaveBeenCalledWith(transferData);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when transfer creation fails', async () => {
      const service = new UnitService();
      const transferData = { type: 'achTransfer' };
      const mockError = new Error('Invalid transfer data');

      mockUnitInstance.transfers.create.mockRejectedValue(mockError);

      await expect(service.createTransfer(transferData)).rejects.toThrow('Failed to create transfer: Invalid transfer data');
      expect(mockUnitInstance.transfers.create).toHaveBeenCalledWith(transferData);
    });
  });

  describe('getCustomer', () => {
    it('should successfully get a customer', async () => {
      const service = new UnitService();
      const customerId = 'customer-123';
      const mockResponse = {
        data: {
          id: 'customer-123',
          attributes: {
            email: 'customer@example.com',
            status: 'active'
          }
        }
      };

      mockUnitInstance.customers.get.mockResolvedValue(mockResponse);

      const result = await service.getCustomer(customerId);

      expect(mockUnitInstance.customers.get).toHaveBeenCalledWith(customerId);
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when getting customer fails', async () => {
      const service = new UnitService();
      const customerId = 'customer-123';
      const mockError = new Error('Customer not found');

      mockUnitInstance.customers.get.mockRejectedValue(mockError);

      await expect(service.getCustomer(customerId)).rejects.toThrow('Failed to get customer: Customer not found');
      expect(mockUnitInstance.customers.get).toHaveBeenCalledWith(customerId);
    });
  });
});

