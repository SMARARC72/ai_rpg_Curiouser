const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/*
 * OpenAI's image models only accept a FIXED set of sizes — you cannot ask for
 * arbitrary dimensions. Requesting anything else (e.g. a 1280x720 location map)
 * makes the API reject the request, so that image silently never appears.
 *
 * Each model family offers a square, a portrait, and a landscape option; we snap
 * whatever width/height the caller asked for to the closest one by orientation.
 * That lets the game keep requesting natural dimensions per image type (wide
 * maps, tall portraits, square items) and always get a valid, aspect-appropriate
 * size back.
 *   - gpt-image-1: 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape)
 *   - dall-e-3:    1024x1024, 1024x1792 (portrait), 1792x1024 (landscape)
 *   - dall-e-2:    only square sizes (256/512/1024)
 * Unknown/custom model names default to the gpt-image-1 set (the modern default).
 */
const OPENAI_SIZE_SETS = {
  'gpt-image-1': { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' },
  'dall-e-3':    { square: '1024x1024', portrait: '1024x1792', landscape: '1792x1024' },
  'dall-e-2':    { square: '1024x1024', portrait: '1024x1024', landscape: '1024x1024' }
};

function sizeSetForModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('dall-e-3') || m.includes('dalle-3') || m.includes('dall-e3') || m.includes('dalle3')) return OPENAI_SIZE_SETS['dall-e-3'];
  if (m.includes('dall-e-2') || m.includes('dalle-2') || m.includes('dall-e2') || m.includes('dalle2')) return OPENAI_SIZE_SETS['dall-e-2'];
  return OPENAI_SIZE_SETS['gpt-image-1'];
}

// Snap a requested width/height to the closest valid OpenAI size for the model.
function resolveOpenAISize(model, width, height) {
  const w = Number(width) > 0 ? Number(width) : 1024;
  const h = Number(height) > 0 ? Number(height) : 1024;
  const set = sizeSetForModel(model);
  const ratio = w / h;
  if (ratio >= 1.15) return set.landscape; // clearly wider than tall
  if (ratio <= 0.87) return set.portrait;  // clearly taller than wide
  return set.square;                        // roughly square
}

class OpenAIImageClient {
  constructor(config) {
    const engineConfig = config?.imagegen ?? {};

    this.apiKey = engineConfig.apiKey || process.env.OPENAI_API_KEY;
    this.baseURL = engineConfig.endpoint || 'https://api.openai.com/v1/images/generations';
    this.model = engineConfig.model || null;

    if (!this.apiKey) {
      throw new Error('OpenAI image generation requires imagegen.apiKey or OPENAI_API_KEY.');
    }

    if (!this.model) {
      throw new Error('OpenAI image generation requires imagegen.model.');
    }

    this.timeout = 60000;
  }

  generateRequestId() {
    return crypto.randomUUID();
  }

  async generateImage({ prompt, negativePrompt = '', width = 1024, height = 1024 }) {
    const requestId = this.generateRequestId();

    // Snap the requested dimensions to a size the model actually accepts, chosen
    // by orientation (wide maps → landscape, portraits → portrait, items → square).
    const size = resolveOpenAISize(this.model, width, height);
    const combinedPrompt = negativePrompt
      ? `${prompt}\nNegative prompt: ${negativePrompt}`
      : prompt;

    try {
      const response = await axios.post(
        this.baseURL,
        {
          model: this.model,
          prompt: combinedPrompt,
          size,
          n: 1
        },
        {
          timeout: this.timeout,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          }
        }
      );

      const data = response.data;
      if (!data || !Array.isArray(data.data) || !data.data.length || !data.data[0]?.b64_json) {
        throw new Error('OpenAI image response missing image data.');
      }

      const imageBuffer = Buffer.from(data.data[0].b64_json, 'base64');
      return {
        requestId,
        imageBuffer,
        mimeType: data.data[0]?.mime_type || 'image/png'
      };
    } catch (error) {
      const message = error?.response?.data?.error?.message || error.message || String(error);
      throw new Error(`OpenAI image request failed: ${message}`);
    }
  }

  async saveImage(imageBuffer, imageId, originalFilename, saveDirectory) {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) {
      throw new Error('OpenAI image buffer missing.');
    }

    if (!imageId) {
      throw new Error('OpenAI image save requires an imageId.');
    }

    const ext = path.extname(originalFilename || '') || '.png';
    const filename = `${imageId}${ext}`;
    const filepath = path.join(saveDirectory, filename);

    if (!fs.existsSync(saveDirectory)) {
      fs.mkdirSync(saveDirectory, { recursive: true });
    }

    fs.writeFileSync(filepath, imageBuffer);

    return {
      filename,
      filepath,
      size: imageBuffer.length
    };
  }
}

module.exports = OpenAIImageClient;
module.exports.resolveOpenAISize = resolveOpenAISize;
module.exports.OPENAI_SIZE_SETS = OPENAI_SIZE_SETS;
