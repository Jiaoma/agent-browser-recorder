/**
 * Background Service Worker — Manages recording state, stores actions, coordinates between
 * content scripts and popup.
 *
 * Uses chrome.storage.session for reliable state persistence across popup open/close.
 */

// ============ State (backed by chrome.storage.session) ============

async function getState() {
  const result = await chrome.storage.session.get('recorderState');
  return result.recorderState || {
    isRecording: false,
    actions: [],
    tabId: null,
    startTime: null
  };
}

async function setState(state) {
  await chrome.storage.session.set({ recorderState: state });
}

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
      getState().then(state => sendResponse({
        isRecording: state.isRecording,
        actionCount: state.actions.length,
        startTime: state.startTime,
        tabId: state.tabId
      }));
      return true;
    }
    case 'GET_ACTIONS': {
      getState().then(state => sendResponse({ actions: state.actions }));
      return true;
    }
    case 'CLEAR_ACTIONS': {
      getState().then(async (state) => {
        state.actions = [];
        await setState(state);
        sendResponse({ success: true });
      });
      return true;
    }
    case 'ACTION_RECORDED': {
      // From content script — store the action
      getState().then(async (state) => {
        state.actions.push(msg.action);
        await setState(state);
        // Forward to popup if open
        chrome.runtime.sendMessage(msg).catch(() => {});
      });
      return true;
    }
  }
  return true; // Keep channel open for async
});

// ============ Recording Control ============

async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    console.error('[AB Recorder] No active tab found');
    return;
  }

  const state = {
    isRecording: true,
    actions: [],
    tabId: tab.id,
    startTime: Date.now()
  };
  await setState(state);

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
  const state = await getState();
  if (!state.isRecording) return state.actions;

  state.isRecording = false;
  await setState(state);

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
  getState().then(async (state) => {
    if (state.tabId === tabId) {
      state.isRecording = false;
      state.tabId = null;
      await setState(state);
      chrome.action.setBadgeText({ text: '' });
    }
  });
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    getState().then(state => {
      if (state.isRecording) {
        stopRecording();
      } else {
        startRecording();
      }
    });
  }
});

console.log('[AB Recorder] Background service worker loaded');
