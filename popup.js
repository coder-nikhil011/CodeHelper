// DSA Mentor Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved settings
  const settings = await chrome.storage.local.get(['apiKey', 'mentorEnabled']);
  
  if (settings.apiKey) {
    document.getElementById('api-key').value = settings.apiKey;
    document.getElementById('status-text').textContent = 'API Key Saved ✓';
  }
  
  if (settings.mentorEnabled !== undefined) {
    document.getElementById('mentor-enabled').checked = settings.mentorEnabled;
  }

  // Save button
  document.getElementById('save-btn').addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key').value.trim();
    const mentorEnabled = document.getElementById('mentor-enabled').checked;

    await chrome.storage.local.set({ apiKey, mentorEnabled });
    
    // Show toast
    const toast = document.getElementById('toast');
    toast.style.opacity = '1';
    document.getElementById('status-text').textContent = 'API Key Saved ✓';
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  });

  // Open mentor in current tab
  document.getElementById('open-btn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const existing = document.getElementById('dsa-mentor-sidebar');
        if (existing) {
          existing.style.display = 'flex';
        } else {
          const btn = document.getElementById('dsa-toggle-btn');
          if (btn) btn.click();
        }
      }
    });
    window.close();
  });
});
