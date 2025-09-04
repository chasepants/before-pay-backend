const { Configuration, PlaidApi } = require('plaid');

class PlaidService {
  constructor() {
    const configuration = new Configuration({
      basePath: this.getBasePath(),
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
          'PLAID-SECRET': process.env.PLAID_SECRET,
        },
      },
    });
    
    this.plaidClient = new PlaidApi(configuration);
  }

  getBasePath() {
    const environment = process.env.PLAID_ENV || 'sandbox';
    switch (environment) {
      case 'development':
        return 'https://development.plaid.com';
      case 'sandbox':
        return 'https://sandbox.plaid.com';
      case 'production':
        return 'https://production.plaid.com';
      default:
        return 'https://sandbox.plaid.com';
    }
  }

  // Create a link token for Plaid Link
  async createLinkToken(userId, clientName = 'BeforePay') {
    try {
      const response = await this.plaidClient.linkTokenCreate({
        user: { client_user_id: userId },
        client_name: clientName,
        country_codes: ['US'],
        language: 'en',
        products: ['auth', 'transactions'],
        account_filters: {
          depository: {
            account_subtypes: ['checking', 'savings']
          }
        }
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to create link token: ${error.message}`);
    }
  }

  // Exchange public token for access token
  async exchangePublicToken(publicToken) {
    try {
      const response = await this.plaidClient.itemPublicTokenExchange({
        public_token: publicToken
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to exchange public token: ${error.message}`);
    }
  }

  // Create a processor token for a specific account
  async createProcessorToken(accessToken, accountId, processor = 'unit') {
    try {
      const response = await this.plaidClient.processorTokenCreate({
        access_token: accessToken,
        account_id: accountId,
        processor: processor
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to create processor token: ${error.message}`);
    }
  }

  // Get account information
  async getAccounts(accessToken) {
    try {
      const response = await this.plaidClient.accountsGet({
        access_token: accessToken
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to get accounts: ${error.message}`);
    }
  }

  // Get account balance
  async getAccountBalance(accessToken, accountIds = null) {
    try {
      const request = {
        access_token: accessToken
      };

      if (accountIds) {
        request.account_ids = accountIds;
      }

      const response = await this.plaidClient.accountsBalanceGet(request);
      return response;
    } catch (error) {
      throw new Error(`Failed to get account balance: ${error.message}`);
    }
  }

  // Get transactions for an account
  async getTransactions(accessToken, startDate, endDate, accountIds = null) {
    try {
      const request = {
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: {
          count: 100,
          offset: 0
        }
      };

      if (accountIds) {
        request.account_ids = accountIds;
      }

      const response = await this.plaidClient.transactionsGet(request);
      return response;
    } catch (error) {
      throw new Error(`Failed to get transactions: ${error.message}`);
    }
  }

  // Get item information
  async getItem(accessToken) {
    try {
      const response = await this.plaidClient.itemGet({
        access_token: accessToken
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to get item: ${error.message}`);
    }
  }

  // Invalidate access token
  async invalidateAccessToken(accessToken) {
    try {
      const response = await this.plaidClient.itemAccessTokenInvalidate({
        access_token: accessToken
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to invalidate access token: ${error.message}`);
    }
  }

  // Get institution by ID
  async getInstitution(institutionId, countryCodes = ['US']) {
    try {
      const response = await this.plaidClient.institutionsGetById({
        institution_id: institutionId,
        country_codes: countryCodes,
        options: {
          include_optional_metadata: true
        }
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to get institution: ${error.message}`);
    }
  }

  // Search institutions
  async searchInstitutions(query, products = ['auth'], countryCodes = ['US']) {
    try {
      const response = await this.plaidClient.institutionsSearch({
        query: query,
        products: products,
        country_codes: countryCodes,
        options: {
          include_optional_metadata: true
        }
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to search institutions: ${error.message}`);
    }
  }

  // Get webhook verification key
  async getWebhookVerificationKey(keyId) {
    try {
      const response = await this.plaidClient.webhookVerificationKeyGet({
        key_id: keyId
      });

      return response;
    } catch (error) {
      throw new Error(`Failed to get webhook verification key: ${error.message}`);
    }
  }
}

module.exports = PlaidService;
