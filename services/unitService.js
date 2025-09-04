const { Unit } = require('@unit-finance/unit-node-sdk');

class UnitService {
  constructor() {
    this.unit = new Unit(process.env.UNIT_API_KEY);
  }

  async createApplication(applicationData) {
    try {
      const response = await this.unit.applications.create(applicationData);
      return response;
    } catch (error) {
      throw new Error(`Failed to create application: ${error.message}`);
    }
  }

  async getApplication(applicationId) {
    try {
      const response = await this.unit.applications.get(applicationId);
      return response;
    } catch (error) {
      throw new Error(`Failed to get application: ${error.message}`);
    }
  }

  async createAccount(accountData) {
    try {
      const response = await this.unit.accounts.create(accountData);
      return response;
    } catch (error) {
      throw new Error(`Failed to create account: ${error.message}`);
    }
  }

  async getAccount(accountId) {
    try {
      const response = await this.unit.accounts.get(accountId);
      return response;
    } catch (error) {
      throw new Error(`Failed to get account: ${error.message}`);
    }
  }

  async createPayment(paymentData) {
    try {
      const response = await this.unit.payments.create(paymentData);
      return response;
    } catch (error) {
      throw new Error(`Failed to create payment: ${error.message}`);
    }
  }

  async createTransfer(transferData) {
    try {
      const response = await this.unit.transfers.create(transferData);
      return response;
    } catch (error) {
      throw new Error(`Failed to create transfer: ${error.message}`);
    }
  }

  async getCustomer(customerId) {
    try {
      const response = await this.unit.customers.get(customerId);
      return response;
    } catch (error) {
      throw new Error(`Failed to get customer: ${error.message}`);
    }
  }
}

module.exports = UnitService;
