// DSA Mentor v2 — Background Service Worker
// Handles: Extension lifecycle, API routing, tab screen capture, Claude Vision

let captureState = {
  streamId: null,
  isCapturing: false,
  lastSnapshot: null,
  snapshotInterval: null
};

// ─── Lifecycle Setup ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ 
    apiKey: '', 
    mentorEnabled: true, 
    captureEnabled: true 
  });
});

// ─── Messaging Router ────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === 'startCapture') {
    const tabId = sender.tab ? sender.tab.id : request.tabId;
    startTabCapture(tabId)
      .then(streamId => sendResponse({ success: true, streamId }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep async response channel open
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

// ─── Screen / Tab Capture Stream ─────────────────────────────
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

// ─── Claude Text Generation ──────────────────────────────────
async function callClaudeAPI({ apiKey, messages, systemPrompt }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'dangerously-allow-browser': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      system: systemPrompt || getDSASystemPrompt(),
      messages
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Claude API failed');
  }
  const data = await response.json();
  return data.content[0].text;
}

// ─── Claude Vision Analysis ──────────────────────────────────
async function callClaudeVision({ apiKey, base64Image, prompt, conversationHistory }) {
  const messages = [
    ...(conversationHistory || []),
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
      'anthropic-version': '2023-06-01',
      'dangerously-allow-browser': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
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

// ─── AI Video Script Engine ──────────────────────────────────
async function generateVideoScript({ apiKey, concept, language, stuckPoint, problemTitle }) {
  const prompt = `You are an expert DSA animator. Generate a JSON animation script for teaching "${concept}" to a student stuck on "${problemTitle}".

Student programming language: ${language}
Student stuck issue: ${stuckPoint}

Return ONLY valid JSON in this exact structure:
{
  "title": "${concept}",
  "totalDuration": 30,
  "language": "${language}",
  "frames": [
    {
      "heading": "Short step heading",
      "text": "Explanation in HinEnglish (mix of Hindi + English)",
      "visualization": {
        "type": "array|hashmap|tree",
        "data": [1, 2, 3]
      }
    }
  ]
}

Make 5 to 7 frames explaining the concept step-by-step. Keep visualization data structure format valid for hashmap, tree, or array.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'dangerously-allow-browser': 'true'
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error('Video generation failed');
  const data = await response.json();
  const text = data.content[0].text;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid JSON format returned from video script generator');
  return JSON.parse(jsonMatch[0]);
}

// ─── Complete System Prompt ──────────────────────────────────
function getDSASystemPrompt() {
  return `You are an expert DSA mentor specializing in helping students solve coding interview problems.

Key Guidelines:
1. Speak naturally in HinEnglish (a conversational mix of Hindi and English written in Latin script).
2. NEVER give direct code solutions right away unless the student specifically asks "give me full code" or "show solution".
3. Be supportive and encouraging — if the student makes a mistake, say something like "Almost! Ek chota twist hai..." or "Approach sahi lag raha hai, baseline edge case dekho."
4. Break complex logic into smaller conceptual steps.
5. Focus heavily on time/space complexity (Big-O) and pattern recognition (e.g., Sliding Window, Two Pointers, HashMap lookup, BFS/DFS).
6. When a student is stuck, offer choices:
   - Option A: Guiding question
   - Option B: Step-by-step hint
   - Option C: Visual explanation / AI Video`;
}
