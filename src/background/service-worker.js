/**
 * Background Service Worker — Manages recording state.
 *
 * Key feature: tracks ALL recording tabs, not just one.
 * When recording is active, new tabs auto-start recording via content script polling.
 */

// ============ State ============

let isRecording = false;
let actions = [];
let startTime = null;
let recordingTabIds = new Set(); // Track all tabs that are recording

// ============ Message Handling ============

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING': {
      startRecording().then(() => sendResponse({ success: true }));
      return true;
    }
    case 'STOP_RECORDING': {
      stopRecording().then(() => sendResponse({ success: true, actions }));
      return true;
    }
    case 'GET_STATE': {
      sendResponse({
        isRecording,
        actionCount: actions.length,
        startTime,
      });
      return true;
    }
    case 'GET_ACTIONS': {
      sendResponse({ actions });
      return true;
    }
    case 'CLEAR_ACTIONS': {
      actions = [];
      sendResponse({ success: true });
      return true;
    }
    case 'ACTION_RECORDED': {
      // From any content script tab
      actions.push(msg.action);
      // Forward to popup if open
      chrome.runtime.sendMessage(msg).catch(() => {});
      sendResponse({ success: true });
      return true;
    }
  }
  return false;
});

// ============ Recording Control ============

async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    console.error('[AB Recorder] No active tab found');
    return;
  }

  isRecording = true;
  actions = [];
  startTime = Date.now();
  recordingTabIds.clear();
  recordingTabIds.add(tab.id);

  // Tell content script to start recording
  await sendStartToTab(tab.id);

  // Update badge
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });

  console.log('[AB Recorder] Recording started on tab', tab.id);
}

async function stopRecording() {
  isRecording = false;

  // Tell all recording tabs to stop
  for (const tabId of recordingTabIds) {
    await sendStopToTab(tabId);
  }
  recordingTabIds.clear();

  // Update badge
  chrome.action.setBadgeText({ text: '' });

  console.log(`[AB Recorder] Recording stopped. ${actions.length} actions captured.`);
}

async function sendStartToTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    recordingTabIds.add(tabId);
    console.log('[AB Recorder] Started recording on tab', tabId);
  } catch (e) {
    console.warn('[AB Recorder] Could not reach tab', tabId, e.message);
    // Content script not loaded yet — it will auto-check on load
  }
}

async function sendStopToTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' });
  } catch (e) {
    // Tab might be closed, ignore
  }
}

// ============ Tab Lifecycle ============

// When a new tab is created during recording, mark it for recording
chrome.tabs.onCreated.addListener((tab) => {
  if (!isRecording) return;
  recordingTabIds.add(tab.id);
  console.log('[AB Recorder] New tab created during recording:', tab.id);
  // Content script will auto-check state when it loads (document_idle)
});

// When a tab finishes loading during recording, send START_RECORDING
// (content script may have just been injected for the first time)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!isRecording) return;
  if (changeInfo.status !== 'complete') return;
  if (!recordingTabIds.has(tabId)) return;

  // Give content script a moment to initialize
  setTimeout(() => {
    sendStartToTab(tabId);
  }, 500);
});

// When any recording tab is closed, remove from set
chrome.tabs.onRemoved.addListener((tabId) => {
  recordingTabIds.delete(tabId);
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
});

console.log('[AB Recorder] Background service worker loaded');
