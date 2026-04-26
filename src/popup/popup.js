/**
 * Popup Script — UI controller for the extension popup.
 *
 * Generates agent-browser commands using find text/label/placeholder/testid.
 * Avoids find role (unreliable in current agent-browser).
 */

// ============ Translator (inlined, matches src/lib/translator.js) ============

function shellQuote(str) {
  if (!str) return "''";
  if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function translateCommand(action, locator) {
  switch (action.type) {
    case 'navigate': return `agent-browser open ${shellQuote(action.url)}`;
    case 'press': return `agent-browser press ${action.key}`;
    case 'back': return 'agent-browser back';
    case 'forward': return 'agent-browser forward';
    case 'reload': return 'agent-browser reload';
    case 'scroll': return `agent-browser scroll ${action.direction} ${action.amount || ''}`.trim();
    case 'tab_new': return `agent-browser open ${action.url ? shellQuote(action.url) : ''} --new-tab`.trim();
    case 'tab_close': return 'agent-browser close';
  }
  const actionMap = { click: 'click', dblclick: 'dblclick', type: 'fill', select: 'fill', check: 'check', uncheck: 'uncheck', hover: 'hover', focus: 'focus' };
  const abAction = actionMap[action.type] || 'click';
  const isFill = action.type === 'type' || action.type === 'select';
  if (!locator || !locator.strategy) {
    if (isFill) return `agent-browser fill ${shellQuote(action.cssSelector || 'body')} ${shellQuote(action.value)}`;
    return `agent-browser ${abAction} ${shellQuote(action.cssSelector || 'body')}`;
  }
  switch (locator.strategy) {
    case 'testid':
      if (isFill) return `agent-browser find testid ${shellQuote(locator.value)} fill ${shellQuote(action.value)}`;
      return `agent-browser find testid ${shellQuote(locator.value)} ${abAction}`;
    case 'label':
      if (isFill) return `agent-browser find label ${shellQuote(locator.value)} fill ${shellQuote(action.value)}`;
      return `agent-browser find label ${shellQuote(locator.value)} ${abAction}`;
    case 'placeholder':
      if (isFill) return `agent-browser find placeholder ${shellQuote(locator.value)} fill ${shellQuote(action.value)}`;
      return `agent-browser find placeholder ${shellQuote(locator.value)} ${abAction}`;
    case 'text':
      if (isFill) return `agent-browser find text ${shellQuote(locator.value)} fill ${shellQuote(action.value)}`;
      return `agent-browser find text ${shellQuote(locator.value)} ${abAction}`;
    case 'css':
    default:
      if (isFill) return `agent-browser fill ${shellQuote(locator.value)} ${shellQuote(action.value)}`;
      return `agent-browser ${abAction} ${shellQuote(locator.value)}`;
  }
}

function generateScript(actions) {
  const lines = ['#!/bin/bash', '# Agent Browser Recorder - Auto-generated script', `# Generated: ${new Date().toISOString()}`, ''];
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) {
    lines.push(`agent-browser open ${shellQuote(firstNav.action.url)}`);
    lines.push('agent-browser wait --load networkidle');
    lines.push('agent-browser snapshot -i');
    lines.push('');
  }
  for (const { action, locator } of actions) {
    if (action === firstNav?.action && action.type === 'navigate') continue;
    if (action.type === 'navigate' && action !== firstNav?.action) continue;
    if (action.description) lines.push(`# ${action.description}`);
    lines.push(translateCommand(action, locator));
    if (action.type === 'click') lines.push('agent-browser wait --load networkidle');
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
    if (action.type === 'navigate' && action !== firstNav?.action) continue;
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

// ============ Popup Logic ============

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

btnRecord.addEventListener('click', () => { if (isRecording) stopRecording(); else startRecording(); });
btnStop.addEventListener('click', stopRecording);
btnClear.addEventListener('click', clearRecording);
btnExportShell.addEventListener('click', () => downloadExport('shell'));
btnExportJSON.addEventListener('click', () => downloadExport('json'));
btnCopyCommands.addEventListener('click', copyCommands);

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

async function loadState() {
  try {
    const state = await sendMsg({ type: 'GET_STATE' });
    if (!state) return;
    isRecording = state.isRecording;
    startTime = state.startTime;
    if (isRecording) { setRecordingUI(true); startDurationTimer(); }
    const result = await sendMsg({ type: 'GET_ACTIONS' });
    if (result && result.actions && result.actions.length > 0) {
      actions = result.actions;
      renderActionList();
      actionCountEl.textContent = actions.length;
      updatePreview();
    }
    updateExportButtons();
  } catch (e) { console.error('[AB Recorder] loadState error:', e); }
}

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) { resolve(null); } else { resolve(response); }
    });
  });
}

async function startRecording() {
  await sendMsg({ type: 'START_RECORDING' });
  isRecording = true; startTime = Date.now(); actions = [];
  setRecordingUI(true); startDurationTimer(); renderActionList(); updatePreview(); updateExportButtons();
}

async function stopRecording() {
  await sendMsg({ type: 'STOP_RECORDING' });
  isRecording = false;
  const result = await sendMsg({ type: 'GET_ACTIONS' });
  if (result && result.actions) actions = result.actions;
  setRecordingUI(false); stopDurationTimer(); renderActionList();
  actionCountEl.textContent = actions.length; updatePreview(); updateExportButtons();
}

async function clearRecording() {
  await sendMsg({ type: 'CLEAR_ACTIONS' });
  actions = []; renderActionList(); actionCountEl.textContent = '0';
  previewCode.textContent = '// Start recording to see commands here'; updateExportButtons();
}

function setRecordingUI(recording) {
  btnRecord.disabled = recording; btnStop.disabled = !recording; btnClear.disabled = recording;
  if (recording) { statusDot.classList.add('recording'); statusText.textContent = 'Recording...'; btnRecord.classList.add('recording'); }
  else { statusDot.classList.remove('recording'); statusText.textContent = actions.length > 0 ? `${actions.length} actions` : 'Ready'; btnRecord.classList.remove('recording'); }
}

function startDurationTimer() {
  stopDurationTimer();
  durationInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startTime) / 1000);
    durationEl.textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }, 1000);
}

function stopDurationTimer() { if (durationInterval) clearInterval(durationInterval); durationInterval = null; }

function updateExportButtons() {
  const has = actions.length > 0;
  btnExportShell.disabled = !has; btnExportJSON.disabled = !has; btnCopyCommands.disabled = !has;
}

function renderActionList() {
  actionList.innerHTML = '';
  if (actions.length === 0) { actionList.innerHTML = '<div class="empty-state"><span class="empty-icon">🎬</span><p>Click <strong>Record</strong> to start capturing</p><p class="hint">Shortcut: Cmd+Shift+R</p></div>'; return; }
  actions.forEach(a => addActionToList(a));
}

const iconMap = { click: '👆', dblclick: '👆👆', type: '⌨️', select: '📋', check: '✅', uncheck: '⬜', hover: '🖐', press: '⌨️', navigate: '🔗', scroll: '📜' };

function addActionToList(action) {
  const empty = actionList.querySelector('.empty-state'); if (empty) empty.remove();
  const item = document.createElement('div'); item.className = 'action-item';
  const locator = action.locator || {};
  item.innerHTML = `<div class="action-icon ${action.type}">${iconMap[action.type] || '❓'}</div><div class="action-details"><div class="action-type">${action.type}</div><div class="action-desc">${escapeHtml(action.description || '')}</div><div class="action-command">${escapeHtml(translateCommand(action, locator))}</div></div>`;
  actionList.appendChild(item); actionList.scrollTop = actionList.scrollHeight;
}

function updatePreview() {
  previewCode.textContent = actions.length === 0 ? '// Start recording to see commands here' : actions.map(a => translateCommand(a, a.locator || {})).join('\n');
}

function downloadExport(format) {
  if (actions.length === 0) return;
  const wrapped = actions.map(a => ({ action: a, locator: a.locator || {} }));
  let content, filename;
  if (format === 'shell') { content = generateScript(wrapped); filename = 'agent-browser-recording.sh'; }
  else { content = generateBatchCommands(wrapped); filename = 'agent-browser-commands.json'; }
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
    if (chrome.runtime.lastError) { window.open(url, '_blank'); }
    else { const btn = format === 'shell' ? btnExportShell : btnExportJSON; const orig = btn.textContent; btn.textContent = '✅ Saved!'; setTimeout(() => { btn.textContent = orig; }, 2000); }
  });
}

async function copyCommands() {
  if (actions.length === 0) return;
  try { await navigator.clipboard.writeText(actions.map(a => translateCommand(a, a.locator || {})).join('\n')); btnCopyCommands.textContent = '✅ Copied!'; setTimeout(() => { btnCopyCommands.textContent = '📋 Copy'; }, 2000); } catch (e) { console.error('Copy failed:', e); }
}

function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
