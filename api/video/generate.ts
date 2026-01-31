
import { assertVideoModel, sanitizeLog } from '../../lib/guards.js';
import { startArkVideoTask } from '../../lib/ark.js';

export const config = {
  maxDuration: 30, // Just needs to start task
};

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt, imageBase64, driveFileId, sessionFolderId, model, resolution } = req.body;

    // 1. DEFAULT MODEL & GUARD
    const selectedModel = model || process.env.VIDEO_MODEL || 'seedance-1-0-pro-fast-251015';

    // GUARD: Ensure strict Video Model prefix
    try {
      assertVideoModel(selectedModel);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }

    console.log(`[API Video] Starting task with model: ${selectedModel}`);

    // 2. RESOLVE INPUT IMAGE
    // Seedance needs a public URL or Base64 (depending on lib implementation).
    // Our lib/ark supports image_url.
    let inputImageUrl = "";
    
    if (driveFileId) {
       // Prefer using Google Drive Download URL if available
       inputImageUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
    } else if (imageBase64) {
       // TODO: Ark Tasks usually require a URL, not Base64 directly in 'image_url.url' for async tasks.
       // However, we can try passing Data URI. If it fails, we must rely on Drive ID.
       inputImageUrl = imageBase64; 
    }

    if (!inputImageUrl) {
        return res.status(400).json({ error: "No input image provided (driveFileId required)" });
    }

    // 3. START TASK
    const taskId = await startArkVideoTask({
        model: selectedModel,
        prompt: prompt || "Cinematic movement",
        image_url: inputImageUrl,
        resolution: resolution || '480p'
    });

    console.log(`[API Video] Task Started: ${taskId}`);

    // 4. REGISTER TO GOOGLE SHEET (QUEUE)
    // We do this so the existing tick.ts system works
    const gasUrl = process.env.APPS_SCRIPT_BASE_URL;
    if (gasUrl && driveFileId) {
        // Fire and forget update to GAS
        fetch(gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateVideoStatus',
                photoId: driveFileId,
                status: 'processing',
                taskId: taskId,
                videoModel: selectedModel
            })
        }).catch(e => console.error("Failed to update GAS", e));
    }

    return res.status(200).json({ 
        ok: true, 
        taskId, 
        status: 'processing',
        message: 'Video generation started' 
    });

  } catch (error: any) {
    console.error("[API Video] Error:", error.message);
    const status = error.message.includes('Upstream') ? 502 : 500;
    return res.status(status).json({ error: error.message });
  }
}
