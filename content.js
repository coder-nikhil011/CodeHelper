// DSA Mentor v2 — Content Script (Refactored)
(function () {
  'use strict';

  // ─── Global State ──────────────────────────────────────────
  const state = {
    startTime: Date.now(),
    lastCode: '',
    conversationHistory: [],
    sidebarOpen: true,
    platform: detectPlatform(),
    language: 'python',
    isCapturing: false,
    isAnalyzing: false,
    captureStream: null,
    captureCanvas: null,
    captureCtx: null,
    captureVideo: null,
    snapshotInterval: null,
    hintGivenCount: 0,
    lastScreenAnalysis: null
  };

  function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
        resolve(response || { apiKey: '', mentorEnabled: true, captureEnabled: true });
      });
    });
  }

  // ─── Platform Detection ──────────────────────────────────
  function detectPlatform() {
    const h = window.location.hostname;
    if (h.includes('leetcode')) return 'leetcode';
    if (h.includes('hackerrank')) return 'hackerrank';
    if (h.includes('geeksforgeeks')) return 'geeksforgeeks';
    if (h.includes('codeforces')) return 'codeforces';
    if (h.includes('codechef')) return 'codechef';
    return 'unknown';
  }

  function detectLanguage() {
    try {
      const lcLang = document.querySelector('[data-cy="lang-select"] button, .ant-select-selection-item, #select-language');
      if (lcLang) {
        const t = lcLang.innerText.toLowerCase();
        if (t.includes('python')) return 'python';
        if (t.includes('java') && !t.includes('script')) return 'java';
        if (t.includes('javascript') || t.includes('js')) return 'javascript';
        if (t.includes('c++') || t.includes('cpp')) return 'cpp';
      }
    } catch (e) {}
    return 'python';
  }

  // ─── Multi-Platform Scraping Engine ──────────────────────
  function getProblemData() {
    let title = '', description = '', code = '';

    try {
      if (state.platform === 'leetcode') {
        title = document.querySelector('.text-title-large, [data-cy="question-title"], h4.text-lg')?.innerText?.trim() || '';
        description = document.querySelector('.elfjS, [data-cy="question-content"], div[data-track-load="description_content"]')?.innerText?.trim() || '';
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        code = Array.from(lines).map(l => l.innerText).join('\n');

      } else if (state.platform === 'codeforces') {
        title = document.querySelector('.problem-statement .header .title')?.innerText?.trim() || document.title;
        description = document.querySelector('.problem-statement .header + div')?.innerText?.trim() || '';
        const cm = document.querySelector('.CodeMirror');
        if (cm && cm.CodeMirror) {
          code = cm.CodeMirror.getValue();
        } else {
          code = document.querySelector('#source, textarea[name="source"]')?.value || '';
        }

      } else if (state.platform === 'codechef') {
        title = document.querySelector('h1._problem_title__container_, .problem-title')?.innerText?.trim() || document.title;
        description = document.querySelector('#problem-statement, ._problem_statement_')?.innerText?.trim() || '';
        const lines = document.querySelectorAll('.monaco-editor .view-line');
        if (lines.length > 0) {
          code = Array.from(lines).map(l => l.innerText).join('\n');
        } else {
          const cm = document.querySelector('.CodeMirror');
          code = cm?.CodeMirror?.getValue() || '';
        }

      } else if (state.platform === 'hackerrank') {
        title = document.querySelector('.challenge-name, h1.hr-heading')?.innerText?.trim() || '';
        description = document.querySelector('.challenge-body-html')?.innerText?.trim() || '';
        const cm = document.querySelector('.CodeMirror');
        code = cm?.CodeMirror?.getValue() || '';

      } else if (state.platform === 'geeksforgeeks') {
        title = document.querySelector('h3.content-header-title, .problem-statement h3')?.innerText?.trim() || '';
        description = document.querySelector('.problem-statement, .problems_problem_content__Xm_eO')?.innerText?.trim() || '';
        const cm = document.querySelector('.CodeMirror');
        code = cm?.CodeMirror?.getValue() || '';
      }
    } catch (e) {
      console.warn('Scraping notice:', e);
    }

    state.language = detectLanguage();

    return {
      title: title.slice(0, 200),
      description: description.slice(0, 1500),
      code: code.slice(0, 2500),
      platform: state.platform,
      language: state.language
    };
  }

  function appendMessage(sender, text) {
    const msgBox = document.getElementById('dsa-messages');
    if (!msgBox) return;
    const msg = document.createElement('div');
    msg.className = `dsa-msg dsa-msg-${sender}`;
    msg.innerText = text;
    msgBox.appendChild(msg);
    msgBox.scrollTop = msgBox.scrollHeight;
  }

  // ─── Screen Capture Mechanics ─────────────────────────────
  async function startScreenCapture() {
    if (state.isCapturing) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'startCapture', tabId: null });
      if (!resp || !resp.success) throw new Error(resp?.error || 'Capture initiation failed');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: resp.streamId,
            maxWidth: 1280,
            maxHeight: 720,
            maxFrameRate: 1
          }
        }
      });

      state.captureStream = stream;
      state.isCapturing = true;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.style.display = 'none';
      video.muted = true;
      video.play();
      document.body.appendChild(video);

      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      state.captureCanvas = canvas;
      state.captureCtx = canvas.getContext('2d');
      state.captureVideo = video;

      state.snapshotInterval = setInterval(() => takeAndAnalyzeSnapshot(), 15000);
    } catch (e) {
      console.warn('DSA Mentor capture notice:', e.message);
      state.isCapturing = false;
    }
  }

  function captureFrame() {
    if (!state.captureCtx || !state.captureVideo) return null;
    try {
      state.captureCtx.drawImage(state.captureVideo, 0, 0, 1280, 720);
      return state.captureCanvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    } catch (e) { return null; }
  }

  async function takeAndAnalyzeSnapshot() {
    if (state.isAnalyzing) return; // Prevent concurrent requests
    const settings = await getSettings();
    if (!settings.apiKey || !state.sidebarOpen || !settings.captureEnabled) return;

    const frame = captureFrame();
    const domData = getProblemData();

    if (frame) {
      state.isAnalyzing = true;
      await analyzeWithVision(frame, domData, settings.apiKey);
      state.isAnalyzing = false;
    }
  }

  async function analyzeWithVision(base64Image, domData, apiKey) {
    const prompt = `Student is solving: ${domData.title}
Code:
\`\`\`${domData.language}
${domData.code || '(empty)'}
\`\`\`

Analyze the screenshot and code. Is the student stuck? 
Respond strictly in JSON format:
{"stuck": true/false, "issue": "...", "concept": "...", "intervene": true/false, "message": "HinEnglish response"}`;

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'callGeminiVision',
        payload: { apiKey, base64Image, prompt, conversationHistory: [] }
      });

      if (resp && resp.success) {
        const jsonMatch = resp.data.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          state.lastScreenAnalysis = analysis;

          if (analysis.intervene && analysis.stuck) {
            state.hintGivenCount++;
            if (state.hintGivenCount >= 2) {
              showVideoOffer(analysis.concept, domData);
            } else {
              appendMessage('mentor', `👀 Screen update: ${analysis.message}`);
            }
          }
        }
      }
    } catch (e) {
      console.error('Vision analysis error:', e);
    }
  }

  // ─── UI Interactions ──────────────────────────────────────
  function showVideoOffer(concept, domData) {
    document.getElementById('dsa-video-offer')?.remove();

    const d = document.createElement('div');
    d.id = 'dsa-video-offer';
    d.className = 'dsa-video-offer-card';
    d.innerHTML = `
      <div class="dsa-video-offer-header">
        <span class="dsa-video-offer-icon">🎬</span>
        <div>
          <div class="dsa-video-offer-title">Need visual help?</div>
          <div class="dsa-video-offer-sub">Generate an AI concept video!</div>
        </div>
      </div>
      <div class="dsa-video-offer-concept">📌 Concept: <strong>${concept}</strong></div>
      <div class="dsa-video-btns">
        <button id="dsa-btn-ai-vid">✨ Play AI Video</button>
        <button id="dsa-btn-yt-vid">▶ Search YouTube</button>
      </div>
    `;
    document.getElementById('dsa-messages')?.appendChild(d);

    document.getElementById('dsa-btn-yt-vid')?.addEventListener('click', () => {
      const q = `${concept} ${domData.language} DSA tutorial`;
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, '_blank');
    });

    document.getElementById('dsa-btn-ai-vid')?.addEventListener('click', async () => {
      const btn = document.getElementById('dsa-btn-ai-vid');
      if (btn) { btn.textContent = '⏳ Generating Video...'; btn.disabled = true; }

      const settings = await getSettings();
      if (!settings.apiKey) {
        appendMessage('mentor', '⚠️ Please set your API key in settings.');
        if (btn) { btn.textContent = '✨ Play AI Video'; btn.disabled = false; }
        return;
      }

      const resp = await chrome.runtime.sendMessage({
        action: 'generateAIVideo',
        payload: {
          apiKey: settings.apiKey,
          concept,
          language: domData.language || 'python',
          stuckPoint: state.lastScreenAnalysis?.issue || 'General approach',
          problemTitle: domData.title
        }
      });

      if (btn) { btn.textContent = '✨ Play AI Video'; btn.disabled = false; }

      if (resp && resp.success) {
        openVideoPlayer(resp.data);
      } else {
        appendMessage('mentor', `❌ Video Generation Error: ${resp?.error || 'Unknown error'}`);
      }
    });
  }

  // ─── Canvas Video Player Modal ────────────────────────────
  function openVideoPlayer(script) {
    document.getElementById('dsa-video-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'dsa-video-overlay';
    overlay.innerHTML = `
      <div class="dsa-vp-container">
        <div class="dsa-vp-header">
          <div class="dsa-vp-title">🎬 ${script.title || 'Concept Visualizer'}</div>
          <button id="dsa-vp-close-btn">✕</button>
        </div>
        <canvas id="dsa-anim-canvas" width="760" height="380"></canvas>
        <div class="dsa-vp-controls">
          <button id="dsa-vp-prev">◀ Prev</button>
          <div class="dsa-vp-progress"><div class="dsa-vp-progress-bar" id="dsa-vp-bar"></div></div>
          <button id="dsa-vp-next">Next ▶</button>
        </div>
        <div class="dsa-vp-frame-info">
          <div class="dsa-vp-heading" id="dsa-vp-heading"></div>
          <div class="dsa-vp-text" id="dsa-vp-text"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('dsa-vp-close-btn')?.addEventListener('click', () => overlay.remove());

    initVideoPlayer(script);
  }

  function initVideoPlayer(script) {
    let currentFrame = 0;
    const canvas = document.getElementById('dsa-anim-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const frames = script.frames || [];

    function renderFrame(idx) {
      if (idx < 0 || idx >= frames.length) return;
      const frame = frames[idx];
      currentFrame = idx;

      const headingEl = document.getElementById('dsa-vp-heading');
      const textEl = document.getElementById('dsa-vp-text');
      const barEl = document.getElementById('dsa-vp-bar');

      if (headingEl) headingEl.textContent = frame.heading || '';
      if (textEl) textEl.textContent = frame.text || '';
      if (barEl) barEl.style.width = `${((idx + 1) / frames.length) * 100}%`;

      drawVisualization(ctx, canvas, frame);
    }

    document.getElementById('dsa-vp-next')?.addEventListener('click', () => {
      if (currentFrame < frames.length - 1) renderFrame(currentFrame + 1);
    });
    document.getElementById('dsa-vp-prev')?.addEventListener('click', () => {
      if (currentFrame > 0) renderFrame(currentFrame - 1);
    });

    renderFrame(0);
  }

  // ─── Multi-DS Visualizer Engine ────────────────────
  function drawVisualization(ctx, canvas, frame) {
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    const viz = frame.visualization;
    if (!viz || !viz.data) return;

    const vizType = (viz.type || 'array').toLowerCase();

    switch (vizType) {
      case 'hashmap':
      case 'hash_table':
      case 'map':
        drawHashmap(ctx, W, H, viz);
        break;

      case 'tree':
      case 'binary_tree':
        drawTree(ctx, W, H, viz);
        break;

      case 'array':
      case 'stack':
      case 'queue':
      default:
        drawArray(ctx, W, H, viz);
        break;
    }
  }

  // ─── Hashmap Renderer ──────────────────────────────────────
  function drawHashmap(ctx, W, H, viz) {
    const entries = Array.isArray(viz.data) ? viz.data : Object.entries(viz.data || {});
    if (entries.length === 0) return;

    const cardW = 160;
    const cardH = 45;
    const gap = 15;
    const startX = Math.max(20, (W - (cardW + gap) * Math.min(entries.length, 3)) / 2);
    let startY = 100;

    ctx.fillStyle = '#58a6ff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HashMap (Key ➔ Value)', W / 2, 50);

    entries.forEach((item, index) => {
      let key, val;
      if (Array.isArray(item)) {
        [key, val] = item;
      } else if (typeof item === 'object' && item !== null) {
        key = item.key ?? index;
        val = item.val ?? item.value ?? JSON.stringify(item);
      } else {
        key = index;
        val = item;
      }

      const row = Math.floor(index / 3);
      const col = index % 3;
      const x = startX + col * (cardW + gap);
      const y = startY + row * (cardH + gap);

      ctx.fillStyle = '#161b22';
      ctx.strokeStyle = '#30363d';
      ctx.lineWidth = 2;
      ctx.fillRect(x, y, cardW, cardH);
      ctx.strokeRect(x, y, cardW, cardH);

      ctx.fillStyle = '#238636';
      ctx.fillRect(x, y, cardW / 2, cardH);

      ctx.beginPath();
      ctx.moveTo(x + cardW / 2, y);
      ctx.lineTo(x + cardW / 2, y + cardH);
      ctx.strokeStyle = '#30363d';
      ctx.stroke();

      ctx.font = '14px monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(String(key), x + cardW / 4, y + cardH / 2 + 5);

      ctx.fillStyle = '#7ee787';
      ctx.fillText(String(val), x + (3 * cardW) / 4, y + cardH / 2 + 5);
    });
  }

  // ─── Array / Linear DS Renderer (With Pointers Support) ───
  function drawArray(ctx, W, H, viz) {
    const data = Array.isArray(viz.data) ? viz.data : [];
    const pointers = viz.pointers || {}; // e.g., { left: 0, right: 3 }
    const boxW = Math.min(60, (W - 80) / (data.length || 1));
    const boxH = 50;
    const startX = (W - data.length * boxW) / 2;
    const startY = H / 2 - boxH / 2;

    data.forEach((val, i) => {
      const x = startX + i * boxW;
      
      // Draw Array Box
      ctx.fillStyle = '#21262d';
      ctx.strokeStyle = '#58a6ff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x + 2, startY, boxW - 4, boxH);
      ctx.strokeRect(x + 2, startY, boxW - 4, boxH);

      // Value inside Box
      ctx.fillStyle = '#e6edf3';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(val), x + boxW / 2, startY + boxH / 2 + 5);

      // Index below Box
      ctx.fillStyle = '#8b949e';
      ctx.font = '12px monospace';
      ctx.fillText(`[${i}]`, x + boxW / 2, startY + boxH + 20);

      // Render Pointers above Box if present
      Object.entries(pointers).forEach(([ptrName, ptrIdx]) => {
        if (ptrIdx === i) {
          ctx.fillStyle = '#f78166';
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText(`↓ ${ptrName}`, x + boxW / 2, startY - 10);
        }
      });
    });
  }

  // ─── Tree DS Renderer ──────────────────────────────────────
  function drawTree(ctx, W, H, viz) {
    const nodes = Array.isArray(viz.data) ? viz.data : [];
    ctx.fillStyle = '#58a6ff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Binary Tree Visualization', W / 2, 40);

    nodes.forEach((node, i) => {
      const cx = W / 2 + (i % 2 === 0 ? -1 : 1) * (i * 35);
      const cy = 100 + Math.floor(i / 2) * 70;

      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fillStyle = '#1f6feb';
      ctx.fill();
      ctx.strokeStyle = '#58a6ff';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(node.val ?? node), cx, cy + 5);
    });
  }

  // Initialize screen capture on supported pages
  startScreenCapture();
})();
