/**
 * Popup Script — UI controller for the extension popup.
 *
 * Exports Shell scripts that use snapshot+ref strategy for reliable playback.
 * Preview shows simplified commands; exported .sh uses the full snapshot-based approach.
 */

// ============ Translator (inlined from src/lib/translator.js) ============

function shellQuote(str) {
  if (!str) return "''";
  if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function cmdForSimpleAction(action) {
  switch (action.type) {
    case 'navigate': return `agent-browser open ${shellQuote(action.url)}`;
    case 'press': return `agent-browser press ${action.key}`;
    case 'back': return 'agent-browser back';
    case 'forward': return 'agent-browser forward';
    case 'reload': return 'agent-browser reload';
    case 'scroll': return `agent-browser scroll ${action.direction} ${action.amount || ''}`.trim();
    default: return '';
  }
}

function translateCommandPreview(action, locator) {
  if (['press','back','forward','reload','scroll'].includes(action.type)) return cmdForSimpleAction(action);
  if (action.type === 'navigate') return `agent-browser open ${shellQuote(action.url)}`;
  const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                     check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
  const isFill = action.type === 'type' || action.type === 'select';
  const text = (locator && locator.value) || '';
  if (text && isFill) return `agent-browser find text ${shellQuote(text)} fill ${shellQuote(action.value)}`;
  if (text) return `agent-browser find text ${shellQuote(text)} ${abAction}`;
  if (isFill) return `agent-browser fill ${shellQuote(action.cssSelector||'body')} ${shellQuote(action.value)}`;
  return `agent-browser ${abAction} ${shellQuote(action.cssSelector||'body')}`;
}

function generateScript(actions) {
  const lines = [
    '#!/bin/bash',
    '# Agent Browser Recorder — Auto-generated script',
    `# Generated: ${new Date().toISOString()}`,
    '# Strategy: snapshot → grep ref → act on @ref',
    '',
    '# Helper: get ref from snapshot by text search',
    'ab_ref() {',
    '  agent-browser snapshot -i 2>/dev/null | grep -i "$1" | head -1 | grep -o "ref=e[0-9]*" | cut -d= -f2',
    '}',
    ''
  ];
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) {
    lines.push(`agent-browser open ${shellQuote(firstNav.action.url)}`);
    lines.push('agent-browser wait --load networkidle');
    lines.push('');
  }
  for (const { action, locator } of actions) {
    if (action.type === 'navigate') continue;
    if (action.description) lines.push(`# ${action.description}`);
    if (['press','back','forward','reload','scroll'].includes(action.type)) {
      lines.push(cmdForSimpleAction(action)); lines.push(''); continue;
    }
    const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                       check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
    const isFill = action.type === 'type' || action.type === 'select';
    let search = '';
    if (locator && locator.value) search = locator.value;
    else if (action.description) { const m = action.description.match(/"([^"]+)"/); if (m) search = m[1]; }

    if (search) {
      lines.push(`REF=$(ab_ref ${shellQuote(search)})`);
      lines.push('if [ -n "$REF" ]; then');
      if (isFill) lines.push(`  agent-browser fill "@$REF" ${shellQuote(action.value)}`);
      else lines.push(`  agent-browser ${abAction} "@$REF"`);
      lines.push(`  echo "✓ ${abAction}: ${search.replace(/"/g, '\\"')}"`);
      lines.push('else');
      lines.push(`  echo "✗ Not found: ${search.replace(/"/g, '\\"')}"`);
      lines.push('fi');
    } else {
      const sel = shellQuote(action.cssSelector || 'body');
      if (isFill) lines.push(`agent-browser fill ${sel} ${shellQuote(action.value)}`);
      else lines.push(`agent-browser ${abAction} ${sel}`);
    }
    if (action.type === 'click') lines.push('agent-browser wait --load networkidle');
    lines.push('');
  }
  lines.push('echo "🎬 Script complete"');
  return lines.join('\n');
}

function generateBatchCommands(actions) {
  const commands = [];
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) { commands.push(['open', firstNav.action.url]); commands.push(['wait','--load','networkidle']); }
  for (const { action, locator } of actions) {
    if (action.type === 'navigate') continue;
    const cmd = translateCommandPreview(action, locator).replace(/^agent-browser\s+/, '');
    commands.push(parseCmd(cmd));
  }
  return JSON.stringify(commands, null, 2);
}

function parseCmd(str) {
  const tokens = []; let cur = '', inQ = false, qc = '';
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
  item.innerHTML = `<div class="action-icon ${action.type}">${iconMap[action.type] || '❓'}</div><div class="action-details"><div class="action-type">${action.type}</div><div class="action-desc">${escapeHtml(action.description || '')}</div><div class="action-command">${escapeHtml(translateCommandPreview(action, locator))}</div></div>`;
  actionList.appendChild(item); actionList.scrollTop = actionList.scrollHeight;
}

function updatePreview() {
  previewCode.textContent = actions.length === 0 ? '// Start recording to see commands here' : actions.map(a => translateCommandPreview(a, a.locator || {})).join('\n');
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
  try { await navigator.clipboard.writeText(actions.map(a => translateCommandPreview(a, a.locator || {})).join('\n')); btnCopyCommands.textContent = '✅ Copied!'; setTimeout(() => { btnCopyCommands.textContent = '📋 Copy'; }, 2000); } catch (e) { console.error('Copy failed:', e); }
}

function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
