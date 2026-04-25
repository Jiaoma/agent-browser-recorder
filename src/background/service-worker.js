/**
 * Background Service Worker — Manages recording state, stores actions, coordinates between
 * content scripts and popup.
 */

// State
let recordingState = {
  isRecording: false,
  actions: [],
  tabId: null,
  startTime: null
};

// Listen for messages from content script and popup
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'RECORDING_COMPLETE':
        handleRecordingComplete(msg.actions);
        break;
      case 'ACTION_RECORDED':
        // Forward to popup if open
        broadcastToPopup(msg);
        break;
      case 'STATE':
        // Content script reporting state
        break;
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING':
      startRecording();
      sendResponse({ success: true });
      break;

    case 'STOP_RECORDING':
      stopRecording();
      sendResponse({ success: true, actions: recordingState.actions });
      break;

    case 'GET_STATE':
      sendResponse({
        isRecording: recordingState.isRecording,
        actionCount: recordingState.actions.length,
        startTime: recordingState.startTime,
        tabId: recordingState.tabId
      });
      break;

    case 'GET_ACTIONS':
      sendResponse({ actions: recordingState.actions });
      break;

    case 'CLEAR_ACTIONS':
      recordingState.actions = [];
      sendResponse({ success: true });
      break;

    case 'EXPORT_SCRIPT':
      handleExport(msg.format || 'shell');
      break;

    case 'EXECUTE_COMMAND':
      executeAgentBrowserCommand(msg.command);
      sendResponse({ success: true });
      break;
  }
  return true; // Keep channel open for async response
});

async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  recordingState = {
    isRecording: true,
    actions: [],
    tabId: tab.id,
    startTime: Date.now()
  };

  // Inject and start recording in content script
  await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });

  // Update badge
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff3b30' });

  console.log('[AB Recorder] Recording started on tab', tab.id);
}

async function stopRecording() {
  if (!recordingState.isRecording) return;
  recordingState.isRecording = false;

  // Tell content script to stop
  try {
    await chrome.tabs.sendMessage(recordingState.tabId, { type: 'STOP_RECORDING' });
  } catch (e) {
    console.warn('[AB Recorder] Could not reach content script:', e.message);
  }

  // Update badge
  chrome.action.setBadgeText({ text: '' });

  console.log(`[AB Recorder] Recording stopped. ${recordingState.actions.length} actions captured.`);
}

function handleRecordingComplete(actions) {
  recordingState.actions = actions;
  console.log(`[AB Recorder] Received ${actions.length} actions from content script.`);
}

function broadcastToPopup(msg) {
  // Popup will receive this if it's listening
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup not open, that's fine
  });
}

async function executeAgentBrowserCommand(command) {
  // Execute agent-browser command via native messaging host
  try {
    chrome.runtime.sendNativeMessage('com.agentbrowser.recorder', {
      command: command
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[AB Recorder] Native messaging error:', chrome.runtime.lastError.message);
      } else {
        console.log('[AB Recorder] Command executed:', response);
      }
    });
  } catch (e) {
    console.error('[AB Recorder] Failed to execute command:', e);
  }
}

// Handle tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  if (recordingState.tabId === tabId) {
    recordingState.isRecording = false;
    recordingState.tabId = null;
    chrome.action.setBadgeText({ text: '' });
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (recordingState.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
});

console.log('[AB Recorder] Background service worker loaded');
