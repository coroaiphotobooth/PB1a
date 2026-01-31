
/**
 * BytePlus (ARK) API Helper
 * Menangani komunikasi ke endpoint Generative (Image & Video).
 */

const ARK_BASE_URL = process.env.ARK_BASE_URL?.replace(/\/$/, '') || 'https://ark.ap-southeast.bytepluses.com/api/v3';
const ARK_API_KEY = process.env.ARK_API_KEY;

if (!ARK_API_KEY) {
  console.warn("WARNING: ARK_API_KEY is not set.");
}

const COMMON_HEADERS = {
  'Authorization': `Bearer ${ARK_API_KEY}`,
  'Content-Type': 'application/json'
};

/**
 * Normalizes image input to ensure it is either a valid URL or a Data URI.
 * Handles bare base64 strings by adding standard png prefix.
 */
function normalizeImageInput(input: string, index: number): string {
    if (!input) throw new Error(`Image input at index ${index} is empty.`);
    
    const trimmed = input.trim();
    const len = trimmed.length;
    const preview = trimmed.substring(0, 40).replace(/\n/g, '');

    // 1. Check for HTTP/HTTPS URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        console.log(`[ARK Seedream] Image ${index}: URL detected (${preview}...)`);
        return trimmed;
    }

    // 2. Check for Data URI (Standard)
    if (trimmed.startsWith('data:image/')) {
        console.log(`[ARK Seedream] Image ${index}: Data URI detected (${preview}... Len: ${len})`);
        return trimmed;
    }

    // 3. Check for Bare Base64 (Heuristic)
    // Image base64 is typically long and usually doesn't contain spaces if properly encoded
    if (len > 100 && !trimmed.includes(' ')) {
        console.log(`[ARK Seedream] Image ${index}: Bare Base64 detected, wrapping... (${preview}... Len: ${len})`);
        return `data:image/png;base64,${trimmed}`;
    }

    throw new Error(`Invalid image input at index ${index}. Must be http(s) URL or valid data:image/... URI.`);
}

/**
 * Generate Image menggunakan Seedream
 * Uses /images/generations endpoint (Standard ModelArk Image Gen)
 */
export async function generateArkImage(payload: {
  model: string;
  prompt: string;
  image_urls?: string[]; // Base64 strings or URLs from caller
}) {
  const endpoint = `${ARK_BASE_URL}/images/generations`;
  
  // Normalize Inputs (Seedream requires URL or Data URI)
  let normalizedImages: string[] | undefined = undefined;
  
  if (payload.image_urls && payload.image_urls.length > 0) {
      try {
        normalizedImages = payload.image_urls.map((img, i) => normalizeImageInput(img, i));
      } catch (e: any) {
        console.error("[ARK Seedream] Input Validation Error:", e.message);
        throw e;
      }
  }

  const body = {
    model: payload.model,
    prompt: payload.prompt,
    image: normalizedImages,
    response_format: "url",
    size: "2K", 
    stream: false,
    watermark: true,
    sequential_image_generation: "disabled"
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ARK Seedream] Error ${res.status}:`, errText.substring(0, 500));
      throw new Error(`Upstream Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    
    // Robust Extraction Strategy for various ModelArk response formats
    let resultUrl = null;

    // 1. Standard Seedream Schema: { data: { image_urls: ["..."] } }
    if (data.data?.image_urls && Array.isArray(data.data.image_urls) && data.data.image_urls.length > 0) {
        resultUrl = data.data.image_urls[0];
    }
    // 2. OpenAI-compatible Schema: { data: [{ url: "..." }] }
    else if (Array.isArray(data.data) && data.data[0]?.url) {
        resultUrl = data.data[0].url;
    }
    // 3. Alternative Schema: { data: [{ image_url: "..." }] }
    else if (Array.isArray(data.data) && data.data[0]?.image_url) {
        resultUrl = data.data[0].image_url;
    }
    // 4. Flat URL Schema: { data: { url: "..." } }
    else if (data.data?.url) {
        resultUrl = data.data.url;
    }
    // 5. Root Schema: { image_url: "..." }
    else if (data.image_url) {
        resultUrl = data.image_url;
    }

    if (!resultUrl) {
      const debugStr = JSON.stringify(data).substring(0, 1200);
      console.error("[ARK Seedream] Unexpected Response Structure:", debugStr);
      throw new Error("No image URL found in upstream response. Check logs for structure.");
    }

    return resultUrl;
  } catch (error: any) {
    console.error("[ARK Seedream] Exception:", error.message);
    throw error;
  }
}

/**
 * Generate Video menggunakan Seedance (Async Task Endpoint)
 * Logic preserved as is.
 */
export async function startArkVideoTask(payload: {
  model: string;
  prompt: string;
  image_url?: string; // Input Image for video generation
  duration?: number;
  resolution?: string;
}) {
  const endpoint = `${ARK_BASE_URL}/contents/generations/tasks`;
  
  // Construct Task Payload
  // Explicit type definition to handle mixed object shapes in the array
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: payload.prompt }
  ];

  if (payload.image_url) {
    content.push({ type: "image_url", image_url: { url: payload.image_url } });
  }

  const body = {
    model: payload.model,
    content: content,
    parameters: {
      duration: payload.duration || 5,
      resolution: payload.resolution || '480p',
      audio: false
    }
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[ARK Video] Error ${res.status}:`, errText);
      throw new Error(`Upstream Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const taskId = data.id || data.Result?.id;

    if (!taskId) {
      throw new Error("No Task ID returned from upstream");
    }

    return taskId;
  } catch (error: any) {
    console.error("[ARK Video] Exception:", error.message);
    throw error;
  }
}
