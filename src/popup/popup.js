/**
 * Popup Script — UI controller for the extension popup.
 * Self-contained (no ES module imports for Chrome Manifest V3 compatibility).
 *
 * Export buttons are ALWAYS visible. Disabled when no actions, enabled when actions exist.
 * Uses chrome.downloads.download() to save directly to the browser's default download folder.
 */

// ============ Translator Utilities ============

function shellQuote(str) {
  if (!str) return "''";
  if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function formatSelector(locator) {
  if (!locator) return '@unknown';
  switch (locator.type) {
    case 'testid': return `find testid ${shellQuote(locator.value)} click`;
    case 'role':
      if (locator.role) return `find role ${locator.role} click${locator.value ? ` --name ${shellQuote(locator.value)}` : ''}`;
      return `find text ${shellQuote(locator.value)} click`;
    case 'label': return `find label ${shellQuote(locator.value)}`;
    case 'placeholder': return `find placeholder ${shellQuote(locator.value)}`;
    case 'text': return `find text ${shellQuote(locator.value)} click`;
    case 'css': default: return shellQuote(locator.value);
  }
}

function translateCommand(action, locator) {
  const sel = formatSelector(locator);
  switch (action.type) {
    case 'click': return `agent-browser click ${sel}`;
    case 'dblclick': return `agent-browser dblclick ${sel}`;
    case 'type': return `agent-browser fill ${sel} ${shellQuote(action.value)}`;
    case 'select': return `agent-browser select ${sel} ${shellQuote(action.value)}`;
    case 'check': return `agent-browser check ${sel}`;
    case 'uncheck': return `agent-browser uncheck ${sel}`;
    case 'hover': return `agent-browser hover ${sel}`;
    case 'focus': return `agent-browser focus ${sel}`;
    case 'scroll': return `agent-browser scroll ${action.direction} ${action.amount || ''}`.trim();
    case 'scroll_into_view': return `agent-browser scrollintoview ${sel}`;
    case 'press': return `agent-browser press ${action.key}`;
    case 'navigate': return `agent-browser open ${shellQuote(action.url)}`;
    case 'back': return 'agent-browser back';
    case 'forward': return 'agent-browser forward';
    case 'reload': return 'agent-browser reload';
    case 'tab_new': return `agent-browser tab new ${action.url ? shellQuote(action.url) : ''}`.trim();
    case 'tab_close': return 'agent-browser tab close';
    case 'tab_switch': return `agent-browser tab ${action.tabId || ''}`;
    default: return `# Unknown action: ${action.type}`;
  }
}

function generateScript(actions) {
  const lines = ['#!/bin/bash', '# Agent Browser Recorder - Auto-generated script',
    `# Generated: ${new Date().toISOString()}`, ''];
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) {
    lines.push(`agent-browser open ${shellQuote(firstNav.action.url)}`);
    lines.push('agent-browser wait --load networkidle', '');
  }
  for (const { action, locator } of actions) {
    if (action === firstNav?.action && action.type === 'navigate') continue;
    if (action.description) lines.push(`# ${action.description}`);
    lines.push(translateCommand(action, locator));
    if (action.type === 'navigate' || action.type === 'click') lines.push('agent-browser wait 500');
  }
  lines.push('', '# End of recorded script');
  return lines.join('\n');
}

function generateBatchCommands(actions) {
  const commands = [];
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) { commands.push(['open', firstNav.action.url]); commands.push(['wait', '--load', 'networkidle']); }
  for (const { action, locator } of actions) {
    if (action === firstNav?.action && action.type === 'navigate') continue;
    const cmd = translateCommand(action, locator).replace(/^agent-browser\s+/, '');
    commands.push(parseCmd(cmd));
  }
  return JSON.stringify(commands, null, 2);
}

function parseCmd(str) {
  const tokens = [];
  let cur = '', inQ = false, qc = '';
  for (const ch of str) {
    if (inQ) { if (ch === qc) inQ = false; else cur += ch; }
    else if (ch === "'" || ch === '"') { inQ = true; qc = ch; }
    else if (ch === ' ') { if (cur) tokens.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

// ============ DOM References ============

const btnRecord = document.getElementById('btnRecord');
const btnStop = document.getElementById('btnStop');
const btnClear = document.getElementById('btnClear');
const btnExportShell = document.getElementById('btnExportShell');
const btnExportJSON = document.getElementById('btnExportJSON');
const btnCopyCommands = document.getElementById('btnCopyCommands');
const actionList = document.getElementById('actionList');
const actionCountEl = document.getElementById('actionCount');
const durationEl = document.getElementById('duration');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const previewCode = document.getElementById('previewCode');

let actions = [];
let isRecording = false;
let startTime = null;
let durationInterval = null;

// ============ Init ============

btnRecord.addEventListener('click', () => {
  if (isRecording) stopRecording(); else startRecording();
});
btnStop.addEventListener('click', stopRecording);
btnClear.addEventListener('click', clearRecording);
btnExportShell.addEventListener('click', () => downloadExport('shell'));
btnExportJSON.addEventListener('click', () => downloadExport('json'));
btnCopyCommands.addEventListener('click', copyCommands);

// Listen for real-time action updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ACTION_RECORDED') {
    actions.push(msg.action);
    addActionToList(msg.action);
    actionCountEl.textContent = actions.length;
    updatePreview();
    updateExportButtons();
  }
});

loadState();

// ============ State ============

async function loadState() {
  try {
    const state = await sendMsg({ type: 'GET_STATE' });
    if (!state) return;

    isRecording = state.isRecording;
    startTime = state.startTime;

    if (isRecording) {
      setRecordingUI(true);
      startDurationTimer();
    }

    // Always try to load existing actions
    const result = await sendMsg({ type: 'GET_ACTIONS' });
    if (result && result.actions && result.actions.length > 0) {
      actions = result.actions;
      renderActionList();
      actionCountEl.textContent = actions.length;
      updatePreview();
    }
    updateExportButtons();
  } catch (e) {
    console.error('[AB Recorder] loadState error:', e);
  }
}

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[AB Recorder] Message error:', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// ============ Recording ============

async function startRecording() {
  await sendMsg({ type: 'START_RECORDING' });
  isRecording = true;
  startTime = Date.now();
  actions = [];
  setRecordingUI(true);
  startDurationTimer();
  renderActionList();
  updatePreview();
  updateExportButtons();
}

async function stopRecording() {
  await sendMsg({ type: 'STOP_RECORDING' });
  isRecording = false;
  // Reload from storage
  const result = await sendMsg({ type: 'GET_ACTIONS' });
  if (result && result.actions) actions = result.actions;
  setRecordingUI(false);
  stopDurationTimer();
  renderActionList();
  actionCountEl.textContent = actions.length;
  updatePreview();
  updateExportButtons();
}

async function clearRecording() {
  await sendMsg({ type: 'CLEAR_ACTIONS' });
  actions = [];
  renderActionList();
  actionCountEl.textContent = '0';
  previewCode.textContent = '// Start recording to see commands here';
  updateExportButtons();
}

// ============ UI ============

function setRecordingUI(recording) {
  btnRecord.disabled = recording;
  btnStop.disabled = !recording;
  btnClear.disabled = recording;
  if (recording) {
    statusDot.classList.add('recording');
    statusText.textContent = 'Recording...';
    btnRecord.classList.add('recording');
  } else {
    statusDot.classList.remove('recording');
    statusText.textContent = actions.length > 0 ? `${actions.length} actions` : 'Ready';
    btnRecord.classList.remove('recording');
  }
}

function startDurationTimer() {
  stopDurationTimer();
  durationInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    durationEl.textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }, 1000);
}

function stopDurationTimer() {
  if (durationInterval) clearInterval(durationInterval);
  durationInterval = null;
}

function updateExportButtons() {
  const hasActions = actions.length > 0;
  btnExportShell.disabled = !hasActions;
  btnExportJSON.disabled = !hasActions;
  btnCopyCommands.disabled = !hasActions;
}

function renderActionList() {
  actionList.innerHTML = '';
  if (actions.length === 0) {
    actionList.innerHTML = '<div class="empty-state"><span class="empty-icon">🎬</span><p>Click <strong>Record</strong> to start capturing</p><p class="hint">Shortcut: Cmd+Shift+R</p></div>';
    return;
  }
  actions.forEach(a => addActionToList(a));
}

const iconMap = {
  click: '👆', dblclick: '👆👆', type: '⌨️', select: '📋',
  check: '✅', uncheck: '⬜', hover: '🖐', press: '⌨️',
  navigate: '🔗', scroll: '📜', tab_new: '➕', tab_close: '❌',
  tab_switch: '🔄', back: '⬅️', forward: '➡️', reload: '🔄'
};

function addActionToList(action) {
  const empty = actionList.querySelector('.empty-state');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'action-item';
  const locator = action.locator || {};
  item.innerHTML = `
    <div class="action-icon ${action.type}">${iconMap[action.type] || '❓'}</div>
    <div class="action-details">
      <div class="action-type">${action.type}</div>
      <div class="action-desc">${escapeHtml(action.description || '')}</div>
      <div class="action-command">${escapeHtml(translateCommand(action, locator))}</div>
    </div>`;
  actionList.appendChild(item);
  actionList.scrollTop = actionList.scrollHeight;
}

function updatePreview() {
  if (actions.length === 0) {
    previewCode.textContent = '// Start recording to see commands here';
  } else {
    previewCode.textContent = actions.map(a => translateCommand(a, a.locator || {})).join('\n');
  }
}

// ============ Export (chrome.downloads API) ============

function downloadExport(format) {
  if (actions.length === 0) return;

  const wrapped = actions.map(a => ({ action: a, locator: a.locator || {} }));
  let content, filename;

  if (format === 'shell') {
    content = generateScript(wrapped);
    filename = 'agent-browser-recording.sh';
  } else {
    content = generateBatchCommands(wrapped);
    filename = 'agent-browser-commands.json';
  }

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);

  // Use chrome.downloads to save directly to default downloads folder
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: false  // false = save directly to default downloads folder, no dialog
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[AB Recorder] Download failed:', chrome.runtime.lastError.message);
      // Fallback: open blob URL in new tab
      window.open(url, '_blank');
    } else {
      // Flash the button to confirm
      const btn = format === 'shell' ? btnExportShell : btnExportJSON;
      const orig = btn.textContent;
      btn.textContent = '✅ Saved!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }
  });
}

async function copyCommands() {
  if (actions.length === 0) return;
  const text = actions.map(a => translateCommand(a, a.locator || {})).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    btnCopyCommands.textContent = '✅ Copied!';
    setTimeout(() => { btnCopyCommands.textContent = '📋 Copy'; }, 2000);
  } catch (e) {
    console.error('Copy failed:', e);
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
