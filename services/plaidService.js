require('dotenv').config();
const { Configuration, PlaidApi } = require('plaid');
const axios = require('axios');

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
    const environment = process.env.PLAID_ENVIRONMENT || 'sandbox';
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

  async createLinkToken(userId, clientName = 'BeforePay') {
    try {
      console.log('PlaidService - Environment variables check:');
      console.log('PLAID_CLIENT_ID:', process.env.PLAID_CLIENT_ID ? 'SET' : 'NOT SET');
      console.log('PLAID_SECRET:', process.env.PLAID_SECRET ? 'SET' : 'NOT SET');
      console.log('PLAID_ENVIRONMENT:', process.env.PLAID_ENVIRONMENT || 'NOT SET');
      console.log('Base path:', this.getBasePath());
      
      // const response = await this.plaidClient.linkTokenCreate({
      //   user: { client_user_id: userId },
      //   client_name: clientName,
      //   country_codes: ['US'],
      //   language: 'en',
      //   products: ['auth', 'transactions'],
      //   account_filters: {
      //     depository: {
      //       account_subtypes: ['checking', 'savings']
      //     }
      //   }
      // });

      const response = await axios.post(`https://${process.env.PLAID_ENVIRONMENT}.plaid.com/link/token/create`, {
        client_id: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        user: { client_user_id: userId },
        client_name: 'Beforepay',
        products: ['auth', 'transactions'],
        country_codes: ['US'],
        language: 'en',
        webhook: 'https://your-webhook-url'
      });

      return response;
    } catch (error) {
      console.error('PlaidService createLinkToken error:', error);
      throw new Error(`Failed to create link token: ${error.message}`);
    }
  }

  async exchangePublicToken(publicToken) {
    try {
      const response = await this.plaidClient.itemPublicTokenExchange({
        public_token: publicToken
      });

      console.log(response.data);

      return response;
    } catch (error) {
      throw new Error(`Failed to exchange public token: ${error.message}`);
    }
  }

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
