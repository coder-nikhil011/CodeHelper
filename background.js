// DSA Mentor v2 — Background Service Worker
// Handles: Extension lifecycle, API routing, tab screen capture, Gemini Vision & Text

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
    resolveTabId(sender, request.tabId)
      .then(tabId => startTabCapture(tabId))
      .then(streamId => sendResponse({ success: true, streamId }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep async response channel open
  }

  // Supporting both callClaude and callGemini for backwards compatibility
  if (request.action === 'callClaude' || request.action === 'callGemini') {
    callGeminiAPI(request.payload)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Supporting both callClaudeVision and callGeminiVision
  if (request.action === 'callClaudeVision' || request.action === 'callGeminiVision') {
    callGeminiVision(request.payload)
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
    chrome.storage.local.get(['apiKey', 'mentorEnabled', 'captureEnabled'], (settings) => {
      sendResponse(settings);
    });
    return true;
  }

  if (request.action === 'saveSettings') {
    chrome.storage.local.set(request.settings, () => sendResponse({ success: true }));
    return true;
  }
});

// Helper to reliably find active tab ID
async function resolveTabId(sender, requestedTabId) {
  if (sender.tab && sender.tab.id) return sender.tab.id;
  if (requestedTabId) return requestedTabId;
  
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id) return activeTab.id;
  throw new Error('No active tab found for screen capture');
}

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

// ─── Gemini Text Generation ──────────────────────────────────
async function callGeminiAPI({ apiKey, messages, systemPrompt }) {
  if (!apiKey) throw new Error('Gemini API key is required');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  // Format messages into Gemini's contents payload structure
  const contents = (messages || []).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
  }));

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt || getDSASystemPrompt() }]
    },
    generationConfig: {
      temperature: 0.4
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API Error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Gemini Vision Analysis ──────────────────────────────────
async function callGeminiVision({ apiKey, base64Image, prompt, conversationHistory }) {
  if (!apiKey) throw new Error('Gemini API key is required');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const parts = [];
  if (base64Image) {
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: base64Image
      }
    });
  }
  parts.push({ text: prompt });

  const payload = {
    contents: [
      {
        role: 'user',
        parts: parts
      }
    ],
    systemInstruction: {
      parts: [{ text: getDSASystemPrompt() }]
    },
    generationConfig: {
      responseMimeType: 'application/json', // Enforces strict JSON output
      temperature: 0.2
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini Vision API Error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── AI Video Script Engine (Gemini JSON Mode) ────────────────
async function generateVideoScript({ apiKey, concept, language, stuckPoint, problemTitle }) {
  if (!apiKey) throw new Error('Gemini API key is required');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const prompt = `You are an expert DSA animator. Generate a JSON animation script for teaching "${concept}" to a student stuck on "${problemTitle}".

Student programming language: ${language}
Student stuck issue: ${stuckPoint}

Return JSON with this exact structure:
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

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Video script generation failed');
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error('Empty response received from Gemini API');

  return JSON.parse(text);
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
