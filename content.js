// DSA Mentor v2 — Content Script
// Features: Live screen capture, AI video generation, continuous monitoring

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────
  const state = {
    startTime: Date.now(),
    attempts: 0,
    lastCode: '',
    lastSnapshot: null,
    conversationHistory: [],
    sidebarOpen: false,
    platform: detectPlatform(),
    language: 'python',
    isCapturing: false,
    captureStream: null,
    captureCanvas: null,
    captureCtx: null,
    snapshotInterval: null,
    stuckCheckInterval: null,
    hintGivenCount: 0,
    lastScreenAnalysis: null,
    videoPlayerOpen: false
  };

  // ─── Platform Detection ──────────────────────────────────
  function detectPlatform() {
    const h = window.location.hostname;
    if (h.includes('leetcode')) return 'leetcode';
    if (h.includes('hackerrank')) return 'hackerrank';
    if (h.includes('geeksforgeeks')) return 'geeksforgeeks';
    return 'unknown';
  }

  // ─── Detect Programming Language ────────────────────────
  function detectLanguage() {
    try {
      // LeetCode language selector
      const lcLang = document.querySelector('[data-cy="lang-select"] button, .ant-select-selection-item');
      if (lcLang) {
        const t = lcLang.innerText.toLowerCase();
        if (t.includes('python')) return 'python';
        if (t.includes('java') && !t.includes('script')) return 'java';
        if (t.includes('javascript') || t.includes('js')) return 'javascript';
        if (t.includes('c++') || t.includes('cpp')) return 'cpp';
        if (t.includes('c#')) return 'csharp';
        if (t.includes('go')) return 'go';
        if (t.includes('rust')) return 'rust';
      }
      // HackerRank
      const hrLang = document.querySelector('.select-language .selected-language');
      if (hrLang) return hrLang.innerText.toLowerCase().trim();
    } catch (e) {}
    return 'python'; // default
  }

  // ─── DOM-based Problem Scraping ──────────────────────────
  function getProblemData() {
    let title = '', description = '', code = '';
    try {
      if (state.platform === 'leetcode') {
        title = document.querySelector('.text-title-large, [data-cy="question-title"], h4.text-lg')?.innerText?.trim() || '';
        description = document.querySelector('.elfjS, [data-cy="question-content"]')?.innerText?.trim() || '';
        const lines = document.querySelectorAll('.view-lines .view-line');
        code = Array.from(lines).map(l => l.innerText).join('\n');
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
    } catch (e) {}
    state.language = detectLanguage();
    return {
      title: title.slice(0, 200),
      description: description.slice(0, 1500),
      code: code.slice(0, 2000),
      platform: state.platform,
      language: state.language
    };
  }

  // ─── Screen Capture Setup ────────────────────────────────
  async function startScreenCapture() {
    if (state.isCapturing) return;
    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'startCapture',
        tabId: null
      });
      if (!resp.success) throw new Error(resp.error);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: resp.streamId,
            maxWidth: 1280,
            maxHeight: 720,
            maxFrameRate: 1  // 1fps — low CPU for snapshots only
          }
        }
      });

      state.captureStream = stream;
      state.isCapturing = true;

      // Hidden video element to grab frames
      const video = document.createElement('video');
      video.srcObject = stream;
      video.style.display = 'none';
      video.muted = true;
      video.play();
      document.body.appendChild(video);

      // Canvas for frame extraction
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      state.captureCanvas = canvas;
      state.captureCtx = canvas.getContext('2d');
      state.captureVideo = video;

      updateCaptureStatus(true);
      console.log('DSA Mentor: Screen capture started ✅');

      // Take snapshot every 15 seconds for analysis
      state.snapshotInterval = setInterval(() => takeAndAnalyzeSnapshot(), 15000);

    } catch (e) {
      console.log('DSA Mentor: Capture failed —', e.message);
      updateCaptureStatus(false);
      // Fallback: DOM-only mode
      state.isCapturing = false;
    }
  }

  function stopScreenCapture() {
    if (state.captureStream) {
      state.captureStream.getTracks().forEach(t => t.stop());
      state.captureStream = null;
    }
    if (state.captureVideo) {
      state.captureVideo.remove();
      state.captureVideo = null;
    }
    clearInterval(state.snapshotInterval);
    state.isCapturing = false;
    updateCaptureStatus(false);
  }

  function captureFrame() {
    if (!state.captureCtx || !state.captureVideo) return null;
    try {
      state.captureCtx.drawImage(state.captureVideo, 0, 0, 1280, 720);
      // Return compressed JPEG base64
      return state.captureCanvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    } catch (e) { return null; }
  }

  // ─── Snapshot Analysis ───────────────────────────────────
  async function takeAndAnalyzeSnapshot() {
    const settings = await getSettings();
    if (!settings.apiKey || !state.sidebarOpen) return;

    const frame = captureFrame();
    const domData = getProblemData();

    // Check if code changed
    const codeChanged = domData.code !== state.lastCode;
    state.lastCode = domData.code;

    if (!codeChanged && frame) {
      // Send to Claude Vision for analysis
      analyzeWithVision(frame, domData, settings.apiKey);
    }
  }

  async function analyzeWithVision(base64Image, domData, apiKey) {
    const prompt = `You are a DSA mentor monitoring a student's screen.

Problem: ${domData.title}
Platform: ${domData.platform}
Language: ${domData.language}
Student's current code:
\`\`\`${domData.language}
${domData.code || '(no code yet)'}
\`\`\`

Look at the screenshot and answer:
1. Is the student stuck? (no progress, same error, confused look in code)
2. What error or issue do you see?
3. What concept are they struggling with?
4. Should I intervene now? (yes/no)

Reply in JSON only:
{"stuck": true/false, "issue": "...", "concept": "...", "intervene": true/false, "message": "short HinEnglish message if intervene=true"}`;

    try {
      const resp = await chrome.runtime.sendMessage({
        action: 'callClaudeVision',
        payload: { apiKey, base64Image, prompt, conversationHistory: [] }
      });

      if (resp.success) {
        const text = resp.data;
        const jsonMatch = text.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          state.lastScreenAnalysis = analysis;

          if (analysis.intervene && analysis.stuck) {
            state.hintGivenCount++;
            if (state.hintGivenCount >= 2) {
              // After 2 hints failed → offer AI video
              showVideoOffer(analysis.concept, domData);
            } else {
              appendMessage('mentor', `👀 Screen dekh raha hun — ${analysis.message}`);
            }
          }
        }
      }
    } catch (e) {
      console.log('Vision analysis error:', e);
    }
  }

  // ─── Stuck Detection (DOM-based fallback) ───────────────
  function startStuckDetection() {
    clearInterval(state.stuckCheckInterval);
    let unchangedCount = 0;

    state.stuckCheckInterval = setInterval(() => {
      const current = getProblemData().code;
      if (current === state.lastCode && current.length > 0 && state.sidebarOpen) {
        unchangedCount++;
        if (unchangedCount >= 4) { // 4 × 15s = 60s stuck
          unchangedCount = 0;
          state.hintGivenCount++;
          const analysis = state.lastScreenAnalysis;
          const concept = analysis?.concept || 'is concept';
          const domData = getProblemData();

          if (state.hintGivenCount >= 3) {
            showVideoOffer(concept, domData);
          } else {
            showStuckPrompt();
          }
        }
      } else {
        unchangedCount = 0;
      }
      state.lastCode = current;
    }, 15000);
  }

  function showStuckPrompt() {
    const el = document.getElementById('dsa-stuck-prompt');
    if (el) return;
    const d = document.createElement('div');
    d.id = 'dsa-stuck-prompt';
    d.innerHTML = `
      <div class="dsa-stuck-icon">⏰</div>
      <div class="dsa-stuck-text">Lagta hai thoda ruk gaye ho? Kya help chahiye?</div>
      <div class="dsa-stuck-btns">
        <button onclick="window.dsaStuckChoice('questions')">💭 Questions</button>
        <button onclick="window.dsaStuckChoice('steps')">📋 Steps</button>
        <button onclick="window.dsaStuckChoice('video')">🎬 Video</button>
      </div>
    `;
    document.getElementById('dsa-messages')?.appendChild(d);
    document.getElementById('dsa-messages').scrollTop = 9999;
  }

  window.dsaStuckChoice = function(choice) {
    document.getElementById('dsa-stuck-prompt')?.remove();
    const domData = getProblemData();
    if (choice === 'video') {
      const concept = state.lastScreenAnalysis?.concept || domData.title;
      showVideoOffer(concept, domData);
    } else if (choice === 'questions') {
      sendMentorMessage('mujhe guiding questions do jo mujhe sochne par majboor kare');
    } else {
      sendMentorMessage('step by step approach batao, code mat do');
    }
  };

  // ─── Error Detection ─────────────────────────────────────
  function watchForErrors() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const text = node.innerText || '';
          const errorKeywords = ['Wrong Answer', 'Runtime Error', 'Time Limit Exceeded',
            'Compilation Error', 'Memory Limit', 'Output Limit'];
          for (const keyword of errorKeywords) {
            if (text.includes(keyword)) {
              state.attempts++;
              onErrorDetected(keyword, text);
              break;
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function onErrorDetected(errorType, fullText) {
    if (!state.sidebarOpen) return;
    const domData = getProblemData();

    appendMessage('mentor', `⚠️ **${errorType}** mila (attempt #${state.attempts}) — Screen dekh raha hun...`);

    if (state.isCapturing) {
      const frame = captureFrame();
      if (frame) {
        const settings = await getSettings();
        if (settings.apiKey) {
          const resp = await chrome.runtime.sendMessage({
            action: 'callClaudeVision',
            payload: {
              apiKey: settings.apiKey,
              base64Image: frame,
              prompt: `Student got "${errorType}" on this problem: ${domData.title}
Their code: ${domData.code}
What is wrong? Give a short HinEnglish hint. Do NOT give full solution. Max 3 lines.`,
              conversationHistory: []
            }
          });
          if (resp.success) {
            appendMessage('mentor', resp.data);
            state.hintGivenCount++;
            if (state.attempts >= 3) {
              const concept = state.lastScreenAnalysis?.concept || domData.title;
              showVideoOffer(concept, domData);
            }
          }
        }
      }
    } else {
      // DOM fallback
      if (state.attempts >= 2) {
        sendMentorMessage(`Mujhe ${errorType} aa raha hai attempts ${state.attempts} baar ke baad. Kya galat hai?`);
      }
    }
  }

  // ─── Video Offer ─────────────────────────────────────────
  function showVideoOffer(concept, domData) {
    const el = document.getElementById('dsa-video-offer');
    if (el) el.remove();

    const d = document.createElement('div');
    d.id = 'dsa-video-offer';
    d.className = 'dsa-video-offer-card';
    d.innerHTML = `
      <div class="dsa-video-offer-header">
        <span class="dsa-video-offer-icon">🎬</span>
        <div>
          <div class="dsa-video-offer-title">Hints se nahi hua?</div>
          <div class="dsa-video-offer-sub">AI video + YouTube se samjhao!</div>
        </div>
      </div>
      <div class="dsa-video-offer-concept">📌 Concept: <strong>${concept}</strong></div>
      <div class="dsa-video-offer-lang">💻 Language: <strong>${domData.language || 'Python'}</strong></div>
      <div class="dsa-video-btns">
        <button class="dsa-video-btn-ai" onclick="window.dsaOpenAIVideo('${encodeURIComponent(concept)}', '${encodeURIComponent(domData.language || 'python')}', '${encodeURIComponent(domData.title || '')}')">
          ✨ AI Video Dekho
        </button>
        <button class="dsa-video-btn-yt" onclick="window.dsaOpenYouTube('${encodeURIComponent(concept)}', '${encodeURIComponent(domData.language || 'python')}')">
          ▶ YouTube pe Dekho
        </button>
      </div>
    `;
    document.getElementById('dsa-messages')?.appendChild(d);
    document.getElementById('dsa-messages').scrollTop = 9999;
  }

  window.dsaOpenYouTube = function(concept, language) {
    const q = `${decodeURIComponent(concept)} ${decodeURIComponent(language)} DSA explained tutorial`;
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    window.open(url, '_blank');
  };

  window.dsaOpenAIVideo = async function(conceptEnc, languageEnc, titleEnc) {
    const concept = decodeURIComponent(conceptEnc);
    const language = decodeURIComponent(languageEnc);
    const title = decodeURIComponent(titleEnc);

    const btn = document.querySelector('.dsa-video-btn-ai');
    if (btn) { btn.textContent = '⏳ AI Video bana raha hai...'; btn.disabled = true; }

    const settings = await getSettings();
    if (!settings.apiKey) {
      appendMessage('mentor', '⚠️ API Key set nahi hai!');
      return;
    }

    const stuckPoint = state.lastScreenAnalysis?.issue || 'general concept';

    const resp = await chrome.runtime.sendMessage({
      action: 'generateAIVideo',
      payload: { apiKey: settings.apiKey, concept, language, stuckPoint, problemTitle: title }
    });

    if (btn) { btn.textContent = '✨ AI Video Dekho'; btn.disabled = false; }

    if (resp.success) {
      openVideoPlayer(resp.data);
    } else {
      appendMessage('mentor', `❌ Video nahi bana: ${resp.error}. YouTube try karo!`);
      window.dsaOpenYouTube(conceptEnc, languageEnc);
    }
  };

  // ─── AI Video Player ─────────────────────────────────────
  function openVideoPlayer(script) {
    // Remove existing player
    document.getElementById('dsa-video-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'dsa-video-overlay';

    overlay.innerHTML = `
      <div class="dsa-vp-container">
        <div class="dsa-vp-header">
          <div class="dsa-vp-title">🎬 ${script.title}</div>
          <div class="dsa-vp-meta">
            <span class="dsa-vp-lang-badge">${script.language}</span>
            <span class="dsa-vp-duration">${script.totalDuration}s</span>
          </div>
          <button class="dsa-vp-close" onclick="document.getElementById('dsa-video-overlay').remove()">✕</button>
        </div>

        <canvas id="dsa-anim-canvas" width="760" height="400"></canvas>

        <div class="dsa-vp-controls">
          <button id="dsa-vp-prev" onclick="window.dsaVPPrev()">◀ Prev</button>
          <div class="dsa-vp-progress">
            <div class="dsa-vp-progress-bar" id="dsa-vp-bar"></div>
          </div>
          <button id="dsa-vp-next" onclick="window.dsaVPNext()">Next ▶</button>
        </div>

        <div class="dsa-vp-frame-info">
          <div class="dsa-vp-heading" id="dsa-vp-heading"></div>
          <div class="dsa-vp-text" id="dsa-vp-text"></div>
        </div>

        <div class="dsa-vp-code-box" id="dsa-vp-code-box" style="display:none">
          <pre id="dsa-vp-code"></pre>
        </div>

        <div class="dsa-vp-footer">
          <span id="dsa-vp-frame-count">Frame 1 / ${script.frames.length}</span>
          <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(script.youtubeQuery)}" 
             target="_blank" class="dsa-vp-yt-link">▶ YouTube pe bhi dekho</a>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    initVideoPlayer(script);
  }

  // ─── Canvas Animation Engine ─────────────────────────────
  function initVideoPlayer(script) {
    let currentFrame = 0;
    const canvas = document.getElementById('dsa-anim-canvas');
    const ctx = canvas.getContext('2d');
    const frames = script.frames;

    function renderFrame(idx) {
      if (idx < 0 || idx >= frames.length) return;
      const frame = frames[idx];
      currentFrame = idx;

      // Update text panels
      document.getElementById('dsa-vp-heading').textContent = frame.heading || '';
      document.getElementById('dsa-vp-text').textContent = frame.text || '';
      document.getElementById('dsa-vp-frame-count').textContent = `Frame ${idx + 1} / ${frames.length}`;
      document.getElementById('dsa-vp-bar').style.width = `${((idx + 1) / frames.length) * 100}%`;

      const codeBox = document.getElementById('dsa-vp-code-box');
      if (frame.code) {
        codeBox.style.display = 'block';
        document.getElementById('dsa-vp-code').textContent = frame.code;
      } else {
        codeBox.style.display = 'none';
      }

      // Draw visualization on canvas
      drawVisualization(ctx, canvas, frame);
    }

    window.dsaVPNext = () => { if (currentFrame < frames.length - 1) renderFrame(currentFrame + 1); };
    window.dsaVPPrev = () => { if (currentFrame > 0) renderFrame(currentFrame - 1); };

    // Keyboard nav
    const keyHandler = (e) => {
      if (e.key === 'ArrowRight') window.dsaVPNext();
      if (e.key === 'ArrowLeft') window.dsaVPPrev();
      if (e.key === 'Escape') {
        document.getElementById('dsa-video-overlay')?.remove();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);

    renderFrame(0);
  }

  function drawVisualization(ctx, canvas, frame) {
    const W = canvas.width, H = canvas.height;
    const viz = frame.visualization;

    // Background
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d1117');
    bg.addColorStop(1, '#161b22');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (!viz || viz.type === 'none') {
      // Just show a decorative pattern
      drawDecorativeBackground(ctx, W, H, frame.type);
      return;
    }

    const data = viz.data || [];
    const colors = viz.colors || {};
    const type = viz.type;

    ctx.save();

    if (type === 'array') drawArray(ctx, W, H, data, colors, viz);
    else if (type === 'stack') drawStack(ctx, W, H, data, colors, viz);
    else if (type === 'queue') drawQueue(ctx, W, H, data, colors, viz);
    else if (type === 'hashmap') drawHashmap(ctx, W, H, data, colors, viz);
    else if (type === 'tree') drawTree(ctx, W, H, data, colors, viz);
    else if (type === 'pointer') drawPointerArray(ctx, W, H, data, colors, viz);
    else if (type === 'graph') drawGraph(ctx, W, H, data, colors, viz);
    else drawDecorativeBackground(ctx, W, H, frame.type);

    // Step label
    if (viz.step) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, H - 40, W, 40);
      ctx.fillStyle = '#58a6ff';
      ctx.font = '13px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`→ ${viz.step}`, W / 2, H - 15);
    }

    ctx.restore();
  }

  function drawArray(ctx, W, H, data, colors, viz) {
    if (!data.length) return;
    const boxW = Math.min(70, (W - 80) / data.length);
    const boxH = 60;
    const startX = (W - data.length * boxW) / 2;
    const startY = H / 2 - boxH / 2;

    data.forEach((val, i) => {
      const x = startX + i * boxW;
      const highlight = colors[i] || colors[String(val)];
      
      // Box
      ctx.fillStyle = highlight === 'active' ? '#1c3a5a' :
                      highlight === 'found' ? '#1a3a1a' :
                      highlight === 'compare' ? '#3a2a10' : '#21262d';
      ctx.strokeStyle = highlight === 'active' ? '#58a6ff' :
                        highlight === 'found' ? '#3fb950' :
                        highlight === 'compare' ? '#f0883e' : '#30363d';
      ctx.lineWidth = highlight ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(x + 2, startY, boxW - 4, boxH, 6);
      ctx.fill();
      ctx.stroke();

      // Value
      ctx.fillStyle = highlight === 'found' ? '#3fb950' : highlight ? '#58a6ff' : '#e6edf3';
      ctx.font = `bold ${boxW > 50 ? 20 : 14}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(String(val), x + boxW / 2, startY + boxH / 2 + 6);

      // Index
      ctx.fillStyle = '#8b949e';
      ctx.font = '11px Sora, sans-serif';
      ctx.fillText(String(i), x + boxW / 2, startY + boxH + 18);
    });

    // Draw arrows if any
    if (viz.arrows) {
      viz.arrows.forEach(arrow => {
        const fromX = startX + arrow.from * boxW + boxW / 2;
        const toX = startX + arrow.to * boxW + boxW / 2;
        drawArrow(ctx, fromX, startY - 20, toX, startY - 20, arrow.color || '#58a6ff', arrow.label);
      });
    }
  }

  function drawStack(ctx, W, H, data, colors, viz) {
    const boxW = 120, boxH = 40;
    const startX = W / 2 - boxW / 2;
    const baseY = H - 60;

    // Label
    ctx.fillStyle = '#8b949e';
    ctx.font = '12px Sora, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('STACK (TOP ↑)', W / 2, baseY + 20);

    data.slice().reverse().forEach((val, i) => {
      const y = baseY - (i + 1) * boxH - i * 4;
      const isTop = i === 0;
      ctx.fillStyle = isTop ? '#1c3a5a' : '#21262d';
      ctx.strokeStyle = isTop ? '#58a6ff' : '#30363d';
      ctx.lineWidth = isTop ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(startX, y, boxW, boxH - 4, 4);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = isTop ? '#58a6ff' : '#e6edf3';
      ctx.font = `bold 16px JetBrains Mono`;
      ctx.textAlign = 'center';
      ctx.fillText(String(val), W / 2, y + boxH / 2 + 2);
      if (isTop) {
        ctx.fillStyle = '#3fb950';
        ctx.font = '11px Sora';
        ctx.fillText('← TOP', startX + boxW + 10 + 20, y + boxH / 2 + 2);
      }
    });
  }

  function drawQueue(ctx, W, H, data, colors, viz) {
    if (!data.length) return;
    const boxW = Math.min(80, (W - 120) / data.length);
    const boxH = 55;
    const startX = 60;
    const startY = H / 2 - boxH / 2;

    ctx.fillStyle = '#8b949e'; ctx.font = '12px Sora'; ctx.textAlign = 'left';
    ctx.fillText('FRONT →', 10, startY + boxH / 2 + 4);
    ctx.textAlign = 'right';
    ctx.fillText('← REAR', W - 10, startY + boxH / 2 + 4);

    data.forEach((val, i) => {
      const x = startX + i * (boxW + 4);
      const isFront = i === 0, isRear = i === data.length - 1;
      ctx.fillStyle = isFront ? '#1a3a1a' : isRear ? '#1c3a5a' : '#21262d';
      ctx.strokeStyle = isFront ? '#3fb950' : isRear ? '#58a6ff' : '#30363d';
      ctx.lineWidth = (isFront || isRear) ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(x, startY, boxW, boxH, 4);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = isFront ? '#3fb950' : isRear ? '#58a6ff' : '#e6edf3';
      ctx.font = 'bold 16px JetBrains Mono'; ctx.textAlign = 'center';
      ctx.fillText(String(val), x + boxW / 2, startY + boxH / 2 + 6);
    });
  }

  function drawHashmap(ctx, W, H, data, colors, viz) {
    const entries = Array.isArray(data) ? data : Object.entries(data || {});
    if (!entries.length) return;
    const rows = entries.slice(0, 8);
    const rowH = 38, startX = W / 2 - 160, startY = 40;
    const keyW = 130, valW = 130;

    // Headers
    ctx.fillStyle = '#58a6ff'; ctx.font = 'bold 13px Sora'; ctx.textAlign = 'center';
    ctx.fillText('KEY', startX + keyW / 2, startY - 10);
    ctx.fillText('VALUE', startX + keyW + valW / 2, startY - 10);

    rows.forEach(([k, v], i) => {
      const y = startY + i * rowH;
      const highlight = colors[k] || colors[String(i)];

      // Key box
      ctx.fillStyle = highlight === 'active' ? '#1c3a5a' : '#21262d';
      ctx.strokeStyle = highlight === 'active' ? '#58a6ff' : '#30363d';
      ctx.lineWidth = highlight ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(startX, y, keyW - 4, rowH - 4, 4); ctx.fill(); ctx.stroke();

      // Val box
      ctx.fillStyle = highlight === 'found' ? '#1a3a1a' : '#21262d';
      ctx.strokeStyle = highlight === 'found' ? '#3fb950' : '#30363d';
      ctx.beginPath(); ctx.roundRect(startX + keyW, y, valW - 4, rowH - 4, 4); ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#e6edf3'; ctx.font = '14px JetBrains Mono'; ctx.textAlign = 'center';
      ctx.fillText(String(k), startX + keyW / 2, y + rowH / 2 - 2);
      ctx.fillText(String(v), startX + keyW + valW / 2, y + rowH / 2 - 2);
    });
  }

  function drawTree(ctx, W, H, data, colors, viz) {
    if (!data.length) return;
    // Draw binary tree from array representation
    function drawNode(idx, x, y, spread) {
      if (idx >= data.length || data[idx] === null) return;
      const val = data[idx];
      const highlight = colors[idx] || colors[String(val)];
      const r = 22;

      // Children first (lines)
      const leftIdx = 2 * idx + 1, rightIdx = 2 * idx + 2;
      const childY = y + 70;
      if (leftIdx < data.length && data[leftIdx] !== null) {
        ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x - spread, childY - r); ctx.stroke();
        drawNode(leftIdx, x - spread, childY, spread / 2);
      }
      if (rightIdx < data.length && data[rightIdx] !== null) {
        ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x + spread, childY - r); ctx.stroke();
        drawNode(rightIdx, x + spread, childY, spread / 2);
      }

      // Node circle
      ctx.fillStyle = highlight === 'active' ? '#1c3a5a' : highlight === 'visited' ? '#1a3a1a' : '#21262d';
      ctx.strokeStyle = highlight === 'active' ? '#58a6ff' : highlight === 'visited' ? '#3fb950' : '#30363d';
      ctx.lineWidth = highlight ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      ctx.fillStyle = highlight === 'active' ? '#58a6ff' : highlight === 'visited' ? '#3fb950' : '#e6edf3';
      ctx.font = 'bold 14px JetBrains Mono'; ctx.textAlign = 'center';
      ctx.fillText(String(val), x, y + 5);
    }
    ctx.save();
    drawNode(0, W / 2, 50, W / 5);
    ctx.restore();
  }

  function drawPointerArray(ctx, W, H, data, colors, viz) {
    drawArray(ctx, W, H, data, colors, viz);
    // Draw pointer labels
    if (colors) {
      const boxW = Math.min(70, (W - 80) / (data.length || 1));
      const startX = (W - (data.length || 1) * boxW) / 2;
      const startY = H / 2 - 30;

      Object.entries(colors).forEach(([idx, label]) => {
        if (typeof label === 'string' && isNaN(Number(idx))) return;
        const i = parseInt(idx);
        if (isNaN(i)) return;
        const x = startX + i * boxW + boxW / 2;
        ctx.fillStyle = '#f0883e';
        ctx.font = 'bold 12px Sora';
        ctx.textAlign = 'center';
        if (typeof label === 'string' && label.length < 6) {
          ctx.fillText(label, x, startY - 35);
          // Arrow down
          ctx.strokeStyle = '#f0883e'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x, startY - 28); ctx.lineTo(x, startY - 5); ctx.stroke();
        }
      });
    }
  }

  function drawGraph(ctx, W, H, data, colors, viz) {
    // data = [{id, x, y, edges:[]}]
    if (!data.length) return;
    const nodes = data;

    // Edges
    nodes.forEach(node => {
      (node.edges || []).forEach(targetId => {
        const target = nodes.find(n => n.id === targetId);
        if (!target) return;
        const nx = node.x * W, ny = node.y * H;
        const tx = target.x * W, ty = target.y * H;
        ctx.strokeStyle = '#30363d'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(tx, ty); ctx.stroke();
      });
    });

    // Nodes
    nodes.forEach(node => {
      const x = node.x * W, y = node.y * H, r = 22;
      const highlight = colors[node.id] || colors[String(node.id)];
      ctx.fillStyle = highlight === 'visited' ? '#1a3a1a' : highlight === 'active' ? '#1c3a5a' : '#21262d';
      ctx.strokeStyle = highlight === 'visited' ? '#3fb950' : highlight === 'active' ? '#58a6ff' : '#30363d';
      ctx.lineWidth = highlight ? 2.5 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e6edf3'; ctx.font = 'bold 13px JetBrains Mono'; ctx.textAlign = 'center';
      ctx.fillText(String(node.id), x, y + 5);
    });
  }

  function drawDecorativeBackground(ctx, W, H, type) {
    const icons = { intro: '🚀', concept: '💡', example: '📝', code: '💻', summary: '✅' };
    const emoji = icons[type] || '🧩';
    ctx.font = '80px serif'; ctx.textAlign = 'center';
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#58a6ff';
    ctx.fillText(emoji, W / 2, H / 2 + 30);
    ctx.globalAlpha = 1;
  }

  function drawArrow(ctx, x1, y1, x2, y2, color, label) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    // Arrowhead
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 10 * Math.cos(angle - 0.4), y2 - 10 * Math.sin(angle - 0.4));
    ctx.lineTo(x2 - 10 * Math.cos(angle + 0.4), y2 - 10 * Math.sin(angle + 0.4));
    ctx.closePath(); ctx.fill();
    if (label) {
      ctx.font = '11px Sora'; ctx.textAlign = 'center';
      ctx.fillText(label, (x1 + x2) / 2, (y1 + y2) / 2 - 8);
    }
  }

  // ─── Sidebar UI ──────────────────────────────────────────
  function createSidebar() {
    if (document.getElementById('dsa-mentor-sidebar')) return;
    const sidebar = document.createElement('div');
    sidebar.id = 'dsa-mentor-sidebar';
    sidebar.innerHTML = `
      <div class="dsa-header">
        <div class="dsa-header-left">
          <div class="dsa-avatar">🧑‍💻</div>
          <div>
            <div class="dsa-title">DSA Mentor</div>
            <div class="dsa-subtitle" id="dsa-capture-status">⏳ Starting...</div>
          </div>
        </div>
        <div class="dsa-header-actions">
          <button class="dsa-btn-icon" id="dsa-refresh-btn" title="Reset">↺</button>
          <button class="dsa-btn-icon" id="dsa-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="dsa-messages" id="dsa-messages">
        <div class="dsa-welcome">
          <div class="dsa-welcome-icon">🚀</div>
          <p>Namaste! Main tumhara DSA Mentor hun.</p>
          <p>Main tumhari <strong>screen monitor</strong> karta rahunga — jab bhi stuck hoge, AI video + YouTube link dunga!</p>
          <button class="dsa-start-btn" id="dsa-start-btn">▶ Start Karo</button>
        </div>
      </div>
      <div class="dsa-quick-actions">
        <button class="dsa-quick-btn" data-msg="brute force approach kya hoga?">💡 Brute</button>
        <button class="dsa-quick-btn" data-msg="kaunsa data structure use karein?">📦 DS</button>
        <button class="dsa-quick-btn" data-msg="hint do">🔍 Hint</button>
        <button class="dsa-quick-btn" data-msg="AI video chahiye is concept ka">🎬 Video</button>
      </div>
      <div class="dsa-input-area">
        <textarea id="dsa-user-input" placeholder="Kuch bhi poocho..." rows="2"></textarea>
        <button id="dsa-send-btn">➤</button>
      </div>
    `;
    document.body.appendChild(sidebar);
    state.sidebarOpen = true;
    document.getElementById('dsa-toggle-btn').style.display = 'none';

    document.getElementById('dsa-close-btn').addEventListener('click', closeSidebar);
    document.getElementById('dsa-refresh-btn').addEventListener('click', resetSession);
    document.getElementById('dsa-start-btn').addEventListener('click', startSession);
    document.getElementById('dsa-send-btn').addEventListener('click', handleUserSend);
    document.getElementById('dsa-user-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUserSend(); }
    });
    document.querySelectorAll('.dsa-quick-btn').forEach(btn =>
      btn.addEventListener('click', () => sendMentorMessage(btn.dataset.msg))
    );

    startScreenCapture();
    startStuckDetection();
    watchForErrors();
  }

  function updateCaptureStatus(active) {
    const el = document.getElementById('dsa-capture-status');
    if (el) el.textContent = active ? '🔴 Screen Monitor ON' : '👁 DOM Monitor ON';
  }

  function closeSidebar() {
    stopScreenCapture();
    clearInterval(state.stuckCheckInterval);
    document.getElementById('dsa-mentor-sidebar')?.remove();
    document.getElementById('dsa-video-overlay')?.remove();
    state.sidebarOpen = false;
    document.getElementById('dsa-toggle-btn').style.display = 'flex';
  }

  function resetSession() {
    state.conversationHistory = [];
    state.attempts = 0;
    state.hintGivenCount = 0;
    state.startTime = Date.now();
    state.lastScreenAnalysis = null;
    const msgs = document.getElementById('dsa-messages');
    if (msgs) msgs.innerHTML = `<div class="dsa-msg dsa-msg-mentor"><div class="dsa-msg-avatar">🧑‍💻</div><div class="dsa-msg-bubble"><span>Reset ho gaya! Naya problem shuru karo 🔄</span></div></div>`;
  }

  // ─── Chat ────────────────────────────────────────────────
  async function startSession() {
    const domData = getProblemData();
    document.getElementById('dsa-start-btn')?.remove();
    if (!domData.title && !domData.description) {
      appendMessage('mentor', '⚠️ Problem detect nahi hui. Problem page pe jao!');
      return;
    }
    const msg = `[SCREEN_CONTEXT]
Title: ${domData.title}
Platform: ${domData.platform}
Language: ${domData.language}
Description: ${domData.description}
Code: ${domData.code || '(abhi koi code nahi)'}

TASK 1 karo pehle — problem samjhao HinEnglish mein with example.`;
    await sendMentorMessage(msg, true);
  }

  async function handleUserSend() {
    const input = document.getElementById('dsa-user-input');
    const text = input.value.trim(); if (!text) return;
    input.value = '';

    // Check if user wants video
    if (text.toLowerCase().includes('video')) {
      const domData = getProblemData();
      const concept = state.lastScreenAnalysis?.concept || domData.title || 'DSA concept';
      showVideoOffer(concept, domData);
      return;
    }
    await sendMentorMessage(text);
  }

  async function sendMentorMessage(userText, isHidden = false) {
    if (!isHidden) appendMessage('user', userText);

    const settings = await getSettings();
    if (!settings.apiKey) {
      appendMessage('mentor', '⚠️ API Key nahi hai! Extension icon pe click karo.');
      return;
    }

    // Attach latest screen snapshot if capturing
    const hasFrame = state.isCapturing && state.captureCtx;
    const frame = hasFrame ? captureFrame() : null;

    state.conversationHistory.push({ role: 'user', content: userText });
    showTypingIndicator();

    let resp;
    if (frame) {
      resp = await chrome.runtime.sendMessage({
        action: 'callClaudeVision',
        payload: {
          apiKey: settings.apiKey,
          base64Image: frame,
          prompt: userText,
          conversationHistory: state.conversationHistory.slice(-6)
        }
      });
    } else {
      resp = await chrome.runtime.sendMessage({
        action: 'callClaude',
        payload: {
          apiKey: settings.apiKey,
          systemPrompt: getDSASystemPrompt(),
          messages: state.conversationHistory.slice(-10)
        }
      });
    }

    hideTypingIndicator();

    if (resp.success) {
      state.conversationHistory.push({ role: 'assistant', content: resp.data });
      appendMessage('mentor', resp.data);
    } else {
      appendMessage('mentor', `❌ Error: ${resp.error}`);
    }
  }

  function getDSASystemPrompt() {
    return `You are an expert DSA mentor. Communicate in HinEnglish (mix Hindi + English). Be encouraging, never say "wrong" — say "almost! ek twist hai". Task 1: Explain problem simply with example. Task 2: Guide brute force + data structure. Never give full code unless asked. For stuck students: offer 3 options — guiding questions, step-by-step, or video link. Keep responses concise with emojis.`;
  }

  // ─── UI Helpers ──────────────────────────────────────────
  function appendMessage(type, text) {
    const msgs = document.getElementById('dsa-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = `dsa-msg dsa-msg-${type}`;
    const formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')
      .replace(/(https?:\/\/[^\s<"]+)/g, '<a href="$1" target="_blank">🔗 Open</a>');
    div.innerHTML = type === 'mentor'
      ? `<div class="dsa-msg-avatar">🧑‍💻</div><div class="dsa-msg-bubble"><span>${formatted}</span></div>`
      : `<div class="dsa-msg-bubble"><span>${formatted}</span></div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showTypingIndicator() {
    const msgs = document.getElementById('dsa-messages');
    if (!msgs || document.getElementById('dsa-typing')) return;
    const div = document.createElement('div');
    div.id = 'dsa-typing'; div.className = 'dsa-msg dsa-msg-mentor';
    div.innerHTML = `<div class="dsa-msg-avatar">🧑‍💻</div><div class="dsa-msg-bubble dsa-typing"><span></span><span></span><span></span></div>`;
    msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
  }

  function hideTypingIndicator() { document.getElementById('dsa-typing')?.remove(); }

  async function getSettings() {
    return new Promise(resolve => chrome.runtime.sendMessage({ action: 'getSettings' }, resolve));
  }

  // ─── Toggle Button ────────────────────────────────────────
  function createToggleButton() {
    if (document.getElementById('dsa-toggle-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'dsa-toggle-btn';
    btn.innerHTML = '🧑‍💻<span>DSA Mentor</span>';
    btn.addEventListener('click', createSidebar);
    document.body.appendChild(btn);
  }

  // ─── Init ─────────────────────────────────────────────────
  function init() {
    createToggleButton();
    setTimeout(() => {
      const d = getProblemData();
      if (d.title || d.description) createSidebar();
    }, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
