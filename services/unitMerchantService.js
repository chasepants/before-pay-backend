const axios = require('axios');
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

const UNIT_API_BASE = process.env.UNIT_API_BASE || 'https://api.s.unit.sh';
const UNIT_API_TOKEN = process.env.UNIT_API_KEY;

class UnitMerchantService {
  constructor(axiosInstance = null) {
    this.apiClient = axiosInstance || axios.create({
      baseURL: UNIT_API_BASE,
      headers: {
        'Authorization': `Bearer ${UNIT_API_TOKEN}`,
        'Content-Type': 'application/vnd.api+json',
        'X-Accept-Version': 'V2024_06'
      }
    });
  }

  async createApplicationForm(merchantData) {
    try {
      const {
        merchantId,
        shopifyShopId
      } = merchantData;

      const applicationFormData = {
        data: {
          type: 'applicationForm',
          attributes: {
            idempotencyKey: `merchant-${merchantId}-${Date.now()}`,
            tags: {
              merchantId: merchantId.toString(),
              shopifyShopId: shopifyShopId,
              source: 'shopify-stashpay'
            },
            allowedApplicationTypes: ['SingleMemberBusiness', 'MultipleMemberBusiness', 'SoleProprietorship']
          }
        }
      };

      const response = await this.apiClient.post('/application-forms', applicationFormData);
      
      return {
        id: response.data.data.id,
        attributes: response.data.data.attributes,
        links: response.data.data.links
      };
    } catch (error) {
      console.error('Error creating Unit application form:', error.response?.data || error.message);
      throw new Error('Failed to create Unit application form');
    }
  }

  async createApplication(merchantData) {
    try {
      const {} = merchantData;

      const applicationFormData = {
        data: {
          type: "businessApplication",
          attributes: {
            name: "SnowBoard Company",
            address: {
              street: "496 Broadway",
              city: "Laguna Beach",
              state: "CA",
              postalCode: "92651",
              country: "US"
            },
            phone: {
              countryCode: "1",
              number: "9497463950"
            },
            stateOfIncorporation: "CA",
            ein: "123456789",
            entityType: "Corporation",
            ip: "127.0.0.2",
            numberOfEmployees: "Between50And100",
            yearOfIncorporation: "2014",
            countriesOfOperation: [
              "US"
            ],
            businessVertical: "TechnologyMediaOrTelecom",
            website: "https://www.piedpiper.com",
            contact: {
              fullName: {
                first: "Chase",
                last: "Parks"
              },
              email: "chaseparks@example.com",
              phone: {
                countryCode: "1",
                number: "5555555555"
              }
            },
            officer: {
              fullName: {
                first: "Chase",
                last: "Parks"
              },
              dateOfBirth: "2001-08-10",
              title: "CEO",
              ssn: "000000002",
              email: "chaseparks@example.com",
              phone: {
                countryCode: "1",
                number: "5555555555"
              },
              address: {
                street: "496 Broadway",
                city: "Laguna Beach",
                state: "CA",
                postalCode: "92651",
                country: "US"
              },
              occupation: "ArchitectOrEngineer",
              annualIncome: "Between50kAnd100k",
              sourceOfIncome: "EmploymentOrPayrollIncome"
            },
            beneficialOwners: [
              {
                fullName: {
                  first: "Chase",
                  last: "Parks"
                },
                dateOfBirth: "2001-08-10",
                ssn: "000000002",
                email: "chaseparks@exampole.com",
                percentage: 100,
                phone: {
                  countryCode: "1",
                  number: "5555555555"
                },
                address: {
                  street: "496 Broadway",
                  city: "Laguna Beach",
                  state: "CA",
                  postalCode: "92651",
                  country: "US"
                },
                occupation: "ArchitectOrEngineer",
                annualIncome: "Between50kAnd100k",
                sourceOfIncome: "EmploymentOrPayrollIncome"
              }
            ],
            tags: {
              merchantId: merchantData.merchantId,
              shopifyShopId: merchantData.shopifyShopId
            },
            idempotencyKey:  uuidv4()
          }
        }
      };

      const response = await this.apiClient.post('/applications', applicationFormData);
      
      return {
        id: response.data.data.id,
        attributes: response.data.data.attributes,
        links: response.data.data.links
      };
    } catch (error) {
      console.error('Error creating Unit application form:', error.response?.data || error.message);
      throw new Error('Failed to create Unit application form');
    }
  }

  async getApplicationForm(applicationFormId) {
    try {
      const response = await this.apiClient.get(`/application-forms/${applicationFormId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching Unit application form:', error.response?.data || error.message);
      throw new Error('Failed to fetch Unit application form');
    }
  }

  async createDepositAccount(merchantData) {
    try {
      const {
        merchantId,
        unitApplicationId
      } = merchantData;

      const accountData = {
        data: {
          type: 'depositAccount',
          attributes: {
            depositProduct: 'checking',
            tags: {
              merchantId: merchantId.toString(),
              source: 'shopify-stashpay',
              accountType: 'merchant'
            }
          },
          relationships: {
            customer: {
              data: {
                type: 'customer',
                id: unitApplicationId
              }
            }
          }
        }
      };

      const response = await this.apiClient.post('/accounts', accountData);
      
      return {
        id: response.data.data.id,
        attributes: response.data.data.attributes
      };
    } catch (error) {
      console.error('Error creating Unit deposit account:', error.response?.data || error.message);
      throw new Error('Failed to create Unit deposit account');
    }
  }

}

const unitMerchantService = new UnitMerchantService();

module.exports = {
  UnitMerchantService,
  createUnitApplicationForm: (merchantData) => unitMerchantService.createApplicationForm(merchantData),
  getUnitApplicationForm: (applicationFormId) => unitMerchantService.getApplicationForm(applicationFormId),
  createUnitDepositAccount: (merchantData) => unitMerchantService.createDepositAccount(merchantData),
  createApplication: (merchantData) => unitMerchantService.createApplication(merchantData)
};
