// DSA Mentor v2 — Background Service Worker
// Handles: API calls, screen capture relay, session state

let captureState = {
  streamId: null,
  isCapturing: false,
  lastSnapshot: null,
  snapshotInterval: null
};

// ─── Install ───────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ apiKey: '', mentorEnabled: true, captureEnabled: true });
});

// ─── Message Router ────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'startCapture') {
    startTabCapture(sender.tab?.id || request.tabId)
      .then(streamId => sendResponse({ success: true, streamId }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'callClaude') {
    callClaudeAPI(request.payload)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'callClaudeVision') {
    callClaudeVision(request.payload)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'generateAIVideo') {
    generateVideoScript(request.payload)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'getSettings') {
    chrome.storage.local.get(['apiKey', 'mentorEnabled', 'captureEnabled'], sendResponse);
    return true;
  }

  if (request.action === 'saveSettings') {
    chrome.storage.local.set(request.settings, () => sendResponse({ success: true }));
    return true;
  }
});

// ─── Tab Capture ────────────────────────────────────────
async function startTabCapture(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        captureState.streamId = streamId;
        captureState.isCapturing = true;
        resolve(streamId);
      }
    });
  });
}

// ─── Claude Text API ────────────────────────────────────
async function callClaudeAPI({ apiKey, messages, systemPrompt }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages
    })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'API failed');
  }
  const data = await response.json();
  return data.content[0].text;
}

// ─── Claude Vision API (screenshot analysis) ────────────
async function callClaudeVision({ apiKey, base64Image, prompt, conversationHistory }) {
  const messages = [
    ...( conversationHistory || []),
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64Image }
        },
        { type: 'text', text: prompt }
      ]
    }
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: getDSASystemPrompt(),
      messages
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Vision API failed');
  }
  const data = await response.json();
  return data.content[0].text;
}

// ─── AI Video Script Generator ──────────────────────────
async function generateVideoScript({ apiKey, concept, language, stuckPoint, problemTitle }) {
  const prompt = `You are an expert DSA animator. Generate a JSON animation script for teaching "${concept}" to a student stuck on "${problemTitle}".

The student is coding in: ${language}
They are stuck at: ${stuckPoint}

Return ONLY valid JSON in this exact format:
{
  "title": "concept name",
  "totalDuration": 30,
  "youtubeQuery": "best youtube search query for this concept",
  "youtubeKeywords": ["keyword1", "keyword2"],
  "language": "${language}",
  "frames": [
    {
      "time": 0,
      "duration": 5,
      "type": "intro",
      "heading": "short heading",
      "text": "explanation in HinEnglish (mix Hindi+English)",
      "code": "optional code snippet",
      "highlight": "which part to highlight",
      "visualization": {
        "type": "array|tree|graph|stack|queue|hashmap|pointer|none",
        "data": [],
        "step": "what happens in this step",
        "arrows": [],
        "colors": {}
      }
    }
  ]
}

Make 6-8 frames. Each frame explains one step clearly. Code must be in ${language}. Text must be in HinEnglish. Make visualization data realistic for the concept.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error('Video generation failed');
  const data = await response.json();
  const text = data.content[0].text;

  // Extract JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid video script');
  return JSON.parse(jsonMatch[0]);
}

function getDSASystemPrompt() {
  return `You are an expert DSA mentor. Communicate in HinEnglish (mix of Hindi + English). 
Be encouraging, never say "wrong" — say "almost! ek twist hai".
Never give full code unless student says "show me the code" or "give full solution".
For stuck students: offer Option A (guiding questions), B (step-by-step), C (video).
Keep responses concise with emojis for readability.`;
}
