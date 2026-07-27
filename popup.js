// DSA Mentor v2 — Popup Script
// Manages API Key storage, toggle settings, and UI sync

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const mentorEnabledToggle = document.getElementById('mentorEnabled');
  const captureEnabledToggle = document.getElementById('captureEnabled');
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');

  // 1. Load existing settings from Chrome Storage
  chrome.storage.local.get(['apiKey', 'mentorEnabled', 'captureEnabled'], (items) => {
    if (items.apiKey) {
      apiKeyInput.value = items.apiKey;
    }
    mentorEnabledToggle.checked = items.mentorEnabled !== false; // Default to true
    captureEnabledToggle.checked = items.captureEnabled !== false; // Default to true
  });

  // 2. Toggle password visibility
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '👁️';
    }
  });

  // 3. Save Settings to Chrome Local Storage and notify background/content scripts
  saveBtn.addEventListener('click', () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      mentorEnabled: mentorEnabledToggle.checked,
      captureEnabled: captureEnabledToggle.checked
    };

    chrome.storage.local.set(settings, () => {
      // Show feedback status message
      statusMsg.textContent = '✅ Saved successfully!';
      
      // Notify active tab content script if open
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'settingsUpdated',
            settings
          }).catch(() => {
            // Ignore error if tab doesn't have content script injected
          });
        }
      });

      // Clear message after 2 seconds
      setTimeout(() => {
        statusMsg.textContent = '';
      }, 2000);
    });
  });
});
