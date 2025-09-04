const axios = require('axios');

const searchProducts = async (query, category = null) => {
  try {
    // Check if we have the required API key
    if (!process.env.SERPAPI_KEY) {
      throw new Error('SerpAPI key not configured');
    }

    // Build the search parameters
    const searchParams = {
      api_key: process.env.SERPAPI_KEY,
      engine: 'google_shopping',
      q: query,
      gl: 'us', // Country
      hl: 'en'  // Language
    };

    // Add category if provided
    if (category) {
      searchParams.category = category;
    }

    const response = await axios.get('https://serpapi.com/search.json', {
      params: searchParams,
      timeout: 10000 // 10 second timeout
    });

    const shoppingResults = response.data.shopping_results || [];
    
    const formattedResults = shoppingResults.map(item => ({
      title: item.title,
      price: item.price,
      old_price: item.old_price,
      extracted_price: item.extracted_price,
      thumbnail: item.thumbnail,
      source: item.source,
      source_icon: item.source_icon,
      productLink: item.link,
      rating: item.rating,
      reviews: item.reviews,
      badge: item.badge,
      tag: item.tag,
      delivery: item.delivery
    }));

    return {
      success: true,
      results: formattedResults,
      query: query,
      totalResults: formattedResults.length
    };

  } catch (error) {
    console.log('SerpAPI search error:', error.response?.data || error.message);
    
    // Handle specific error cases
    if (error.response?.status === 401) {
      throw new Error('Invalid SerpAPI key');
    } else if (error.response?.status === 429) {
      throw new Error('SerpAPI rate limit exceeded');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('SerpAPI request timeout');
    } else if (error.response?.status >= 500) {
      throw new Error('SerpAPI service unavailable');
    } else {
      throw new Error('Search service unavailable');
    }
  }
};

const searchByCategory = async (category, query = '') => {
  try {
    // Category-specific search logic
    const results = await searchProducts(query, category);
    return {
      ...results,
      category: category
    };
  } catch (error) {
    console.error('Category search error:', error);
    throw new Error('Category search failed');
  }
};

module.exports = {
  searchProducts,
  searchByCategory
};
