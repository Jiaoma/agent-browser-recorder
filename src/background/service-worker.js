/**
 * Background Service Worker — Manages recording state.
 *
 * Uses in-memory state (reliable) + chrome.storage.local for persistence across
 * service worker restarts. Avoids chrome.storage.session (not available in all Chrome versions).
 */

// ============ In-Memory State ============

let state = {
  isRecording: false,
  actions: [],
  tabId: null,
  startTime: null
};

// ============ Message Handling ============

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING': {
      startRecording().then(() => sendResponse({ success: true }));
      return true;
    }
    case 'STOP_RECORDING': {
      stopRecording().then(actions => sendResponse({ success: true, actions }));
      return true;
    }
    case 'GET_STATE': {
      sendResponse({
        isRecording: state.isRecording,
        actionCount: state.actions.length,
        startTime: state.startTime,
        tabId: state.tabId
      });
      return true;
    }
    case 'GET_ACTIONS': {
      sendResponse({ actions: state.actions });
      return true;
    }
    case 'CLEAR_ACTIONS': {
      state.actions = [];
      sendResponse({ success: true });
      return true;
    }
    case 'ACTION_RECORDED': {
      // From content script — store the action
      state.actions.push(msg.action);
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

  state = {
    isRecording: true,
    actions: [],
    tabId: tab.id,
    startTime: Date.now()
  };

  // Tell content script to start recording
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
  } catch (e) {
    console.warn('[AB Recorder] Could not reach content script (page may need refresh):', e.message);
  }

  // Update badge
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });

  console.log('[AB Recorder] Recording started on tab', tab.id);
}

async function stopRecording() {
  if (!state.isRecording) return state.actions;

  state.isRecording = false;

  // Tell content script to stop
  try {
    await chrome.tabs.sendMessage(state.tabId, { type: 'STOP_RECORDING' });
  } catch (e) {
    console.warn('[AB Recorder] Could not reach content script:', e.message);
  }

  // Update badge
  chrome.action.setBadgeText({ text: '' });

  console.log(`[AB Recorder] Recording stopped. ${state.actions.length} actions captured.`);
  return state.actions;
}

// Handle tab close — stop recording if the tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.tabId === tabId) {
    state.isRecording = false;
    state.tabId = null;
    chrome.action.setBadgeText({ text: '' });
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (state.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
});

console.log('[AB Recorder] Background service worker loaded');
