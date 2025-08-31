const OpenAI = require('openai');

let xai = null;

const initializeXai = () => {
  if (!xai && process.env.XAI_API_KEY) {
    try {
      xai = new OpenAI({
        apiKey: process.env.XAI_API_KEY,
        baseURL: "https://api.x.ai/v1",
      });
    } catch (error) {
      console.error('xAI API key error:', error);
      console.log('XAI_API_KEY:', process.env.XAI_API_KEY);
    }
  }
  return xai;
};

const getXaiClient = () => {
  if (!xai) {
    initializeXai();
  }
  return xai;
};

const generateImage = async (prompt) => {
  const client = getXaiClient();
  if (!client) {
    throw new Error('xAI client not initialized');
  }

  const response = await client.images.generate({
    model: "grok-2-image",
    prompt: prompt,
    n: 1,
    size: "1024x1024",
  });

  return response.data[0].url;
};

const enhanceDescription = async (prompt) => {
  const client = getXaiClient();
  if (!client) {
    throw new Error('xAI client not initialized');
  }

  const response = await client.chat.completions.create({
    model: "grok-4",
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    max_tokens: 150,
    temperature: 0.7,
  });

  return response.choices[0].message.content;
};

module.exports = {
  initializeXai,
  getXaiClient,
  generateImage,
  enhanceDescription
};
