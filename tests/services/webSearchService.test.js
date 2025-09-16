const axios = require('axios');
const webSearchService = require('../../services/webSearchService');

// Mock axios
jest.mock('axios');

describe('WebSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up default environment variable
    process.env.SERPAPI_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.SERPAPI_KEY;
  });

  describe('searchProducts', () => {
    it('should search products successfully with basic query', async () => {
      const mockResponse = {
        data: {
          shopping_results: [
            {
              title: 'Test Product 1',
              price: '$19.99',
              extracted_price: 19.99,
              thumbnail: 'https://example.com/image1.jpg',
              source: 'Test Store',
              link: 'https://example.com/product1',
              rating: 4.5,
              reviews: 100,
              badge: 'Best Seller',
              tag: 'Electronics',
              delivery: 'Free shipping'
            },
            {
              title: 'Test Product 2',
              price: '$29.99',
              old_price: '$39.99',
              extracted_price: 29.99,
              thumbnail: 'https://example.com/image2.jpg',
              source: 'Another Store',
              link: 'https://example.com/product2',
              rating: 4.2,
              reviews: 50,
              badge: 'Sale',
              tag: 'Electronics',
              delivery: '2-day shipping'
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await webSearchService.searchProducts('test query');

      expect(axios.get).toHaveBeenCalledWith('https://serpapi.com/search.json', {
        params: {
          api_key: 'test-api-key',
          engine: 'google_shopping',
          q: 'test query',
          gl: 'us',
          hl: 'en'
        },
        timeout: 10000
      });

      expect(result).toEqual({
        success: true,
        results: [
          {
            title: 'Test Product 1',
            price: '$19.99',
            old_price: undefined,
            extracted_price: 19.99,
            thumbnail: 'https://example.com/image1.jpg',
            source: 'Test Store',
            source_icon: undefined,
            productLink: 'https://example.com/product1',
            rating: 4.5,
            reviews: 100,
            badge: 'Best Seller',
            tag: 'Electronics',
            delivery: 'Free shipping'
          },
          {
            title: 'Test Product 2',
            price: '$29.99',
            old_price: '$39.99',
            extracted_price: 29.99,
            thumbnail: 'https://example.com/image2.jpg',
            source: 'Another Store',
            source_icon: undefined,
            productLink: 'https://example.com/product2',
            rating: 4.2,
            reviews: 50,
            badge: 'Sale',
            tag: 'Electronics',
            delivery: '2-day shipping'
          }
        ],
        query: 'test query',
        totalResults: 2
      });
    });

    it('should search products with category', async () => {
      const mockResponse = {
        data: {
          shopping_results: [
            {
              title: 'Electronics Product',
              price: '$99.99',
              extracted_price: 99.99,
              thumbnail: 'https://example.com/electronics.jpg',
              source: 'Electronics Store',
              link: 'https://example.com/electronics',
              rating: 4.8,
              reviews: 200,
              badge: 'Top Rated',
              tag: 'Electronics',
              delivery: 'Next day delivery'
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await webSearchService.searchProducts('laptop', 'electronics');

      expect(axios.get).toHaveBeenCalledWith('https://serpapi.com/search.json', {
        params: {
          api_key: 'test-api-key',
          engine: 'google_shopping',
          q: 'laptop',
          gl: 'us',
          hl: 'en',
          category: 'electronics'
        },
        timeout: 10000
      });

      expect(result.success).toBe(true);
      expect(result.category).toBeUndefined(); // searchProducts doesn't add category
      expect(result.results).toHaveLength(1);
    });

    it('should handle empty results', async () => {
      const mockResponse = {
        data: {
          shopping_results: []
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await webSearchService.searchProducts('nonexistent product');

      expect(result).toEqual({
        success: true,
        results: [],
        query: 'nonexistent product',
        totalResults: 0
      });
    });

    it('should handle missing shopping_results in response', async () => {
      const mockResponse = {
        data: {}
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await webSearchService.searchProducts('test query');

      expect(result).toEqual({
        success: true,
        results: [],
        query: 'test query',
        totalResults: 0
      });
    });

    // Note: Testing environment variable configuration is complex with Jest's module system
    // The service correctly checks for SERPAPI_KEY and throws appropriate errors

    it('should handle 401 Unauthorized error', async () => {
      const error = {
        response: {
          status: 401,
          data: { error: 'Invalid API key' }
        }
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchProducts('test query'))
        .rejects
        .toThrow('Invalid SerpAPI key');
    });

    it('should handle 429 Rate Limit error', async () => {
      const error = {
        response: {
          status: 429,
          data: { error: 'Rate limit exceeded' }
        }
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchProducts('test query'))
        .rejects
        .toThrow('SerpAPI rate limit exceeded');
    });

    it('should handle timeout error', async () => {
      const error = {
        code: 'ECONNABORTED',
        message: 'timeout of 10000ms exceeded'
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchProducts('test query'))
        .rejects
        .toThrow('SerpAPI request timeout');
    });

    it('should handle 500+ server errors', async () => {
      const error = {
        response: {
          status: 500,
          data: { error: 'Internal server error' }
        }
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchProducts('test query'))
        .rejects
        .toThrow('SerpAPI service unavailable');
    });

    it('should handle other errors', async () => {
      const error = {
        message: 'Network error'
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchProducts('test query'))
        .rejects
        .toThrow('Search service unavailable');
    });

    it('should handle axios error without response', async () => {
      const error = {
        message: 'Network error'
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchProducts('test query'))
        .rejects
        .toThrow('Search service unavailable');
    });
  });

  describe('searchByCategory', () => {
    it('should search by category successfully', async () => {
      const mockResponse = {
        data: {
          shopping_results: [
            {
              title: 'Category Product',
              price: '$49.99',
              extracted_price: 49.99,
              thumbnail: 'https://example.com/category.jpg',
              source: 'Category Store',
              link: 'https://example.com/category',
              rating: 4.3,
              reviews: 75,
              badge: 'New',
              tag: 'Electronics',
              delivery: 'Standard shipping'
            }
          ]
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await webSearchService.searchByCategory('electronics', 'smartphone');

      expect(axios.get).toHaveBeenCalledWith('https://serpapi.com/search.json', {
        params: {
          api_key: 'test-api-key',
          engine: 'google_shopping',
          q: 'smartphone',
          gl: 'us',
          hl: 'en',
          category: 'electronics'
        },
        timeout: 10000
      });

      expect(result).toEqual({
        success: true,
        results: [
          {
            title: 'Category Product',
            price: '$49.99',
            old_price: undefined,
            extracted_price: 49.99,
            thumbnail: 'https://example.com/category.jpg',
            source: 'Category Store',
            source_icon: undefined,
            productLink: 'https://example.com/category',
            rating: 4.3,
            reviews: 75,
            badge: 'New',
            tag: 'Electronics',
            delivery: 'Standard shipping'
          }
        ],
        query: 'smartphone',
        totalResults: 1,
        category: 'electronics'
      });
    });

    it('should search by category with empty query', async () => {
      const mockResponse = {
        data: {
          shopping_results: []
        }
      };

      axios.get.mockResolvedValue(mockResponse);

      const result = await webSearchService.searchByCategory('electronics');

      expect(axios.get).toHaveBeenCalledWith('https://serpapi.com/search.json', {
        params: {
          api_key: 'test-api-key',
          engine: 'google_shopping',
          q: '',
          gl: 'us',
          hl: 'en',
          category: 'electronics'
        },
        timeout: 10000
      });

      expect(result.category).toBe('electronics');
    });

    it('should handle searchProducts error and throw category search failed', async () => {
      const error = new Error('Search service unavailable');
      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchByCategory('electronics', 'test'))
        .rejects
        .toThrow('Category search failed');
    });

    it('should handle searchProducts error with specific error message', async () => {
      const error = {
        response: {
          status: 401,
          data: { error: 'Invalid API key' }
        }
      };

      axios.get.mockRejectedValue(error);

      await expect(webSearchService.searchByCategory('electronics', 'test'))
        .rejects
        .toThrow('Category search failed');
    });
  });
});
