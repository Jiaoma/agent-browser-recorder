/**
 * Content Script — Records user interactions on the page.
 * Captures: clicks, double-clicks, typing, selects, scrolls, keyboard shortcuts, navigation.
 * Self-contained (no ES module imports for Chrome Manifest V3 compatibility).
 */

// ============ Selector Utilities (inlined from lib/selector.js) ============

function buildSelector(el) {
  if (!el || el === document.body || el === document.documentElement) return 'body';
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.testid) return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
  if (el.name && el.tagName !== 'DIV') {
    const byName = document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
    if (byName.length === 1) return `[name="${CSS.escape(el.name)}"]`;
  }
  const tag = el.tagName.toLowerCase();
  if (el.classList.length > 0) {
    const classSelector = `${tag}.${Array.from(el.classList).map(c => CSS.escape(c)).join('.')}`;
    if (document.querySelectorAll(classSelector).length === 1) return classSelector;
  }
  const role = el.getAttribute('role');
  const ariaLabel = el.getAttribute('aria-label');
  if (role && ariaLabel) {
    const ariaSelector = `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`;
    if (document.querySelectorAll(ariaSelector).length === 1) return ariaSelector;
  }
  if (el.placeholder) {
    const phSelector = `${tag}[placeholder="${CSS.escape(el.placeholder)}"]`;
    if (document.querySelectorAll(phSelector).length === 1) return phSelector;
  }
  return buildStructuralPath(el);
}

function buildStructuralPath(el) {
  const parts = [];
  let current = el;
  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) { selector += `:nth-of-type(${siblings.indexOf(current) + 1})`; }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function describeElement(el) {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').trim().substring(0, 60);
  const ariaLabel = el.getAttribute('aria-label');
  const placeholder = el.placeholder;
  const name = el.name;
  const parts = [`<${tag}>`];
  if (el.id) parts.push(`#${el.id}`);
  if (name) parts.push(`name="${name}"`);
  if (ariaLabel) parts.push(`aria="${ariaLabel}"`);
  if (placeholder) parts.push(`placeholder="${placeholder}"`);
  if (text && text.length < 40) parts.push(`"${text}"`);
  return parts.join(' ');
}

function getImplicitRole(el) {
  const tag = el.tagName.toLowerCase();
  const type = el.type?.toLowerCase();
  const roleMap = {
    button: 'button', a: 'link',
    input: type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' ? 'button' : 'textbox',
    select: 'combobox', textarea: 'textbox',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', form: 'form',
    table: 'table', ul: 'list', ol: 'list',
  };
  return roleMap[tag] || null;
}

function getTextContent(el) {
  const text = (el.textContent || '').trim();
  return text.length <= 80 ? text : text.substring(0, 80);
}

function getAgentBrowserLocator(el) {
  if (el.dataset.testid) return { type: 'testid', value: el.dataset.testid };
  const role = el.getAttribute('role') || getImplicitRole(el);
  const ariaLabel = el.getAttribute('aria-label');
  const accessibleName = ariaLabel || getTextContent(el);
  if (role && accessibleName) return { type: 'role', role, value: accessibleName };
  if (el.labels && el.labels.length > 0) {
    const labelText = el.labels[0].textContent.trim();
    if (labelText) return { type: 'label', value: labelText };
  }
  if (el.placeholder) return { type: 'placeholder', value: el.placeholder };
  const text = getTextContent(el);
  if (text && (el.tagName === 'A' || el.tagName === 'BUTTON' || role === 'button'))
    return { type: 'text', value: text };
  return { type: 'css', value: buildSelector(el) };
}

// ============ Recording Logic ============

let isRecording = false;
let recordedActions = [];
let lastTypedElement = null;
let lastTypedValue = '';
let typingTimer = null;
let currentUrl = location.href;

const port = chrome.runtime.connect({ name: 'recorder' });

port.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'START_RECORDING': startRecording(); break;
    case 'STOP_RECORDING': stopRecording(); break;
  }
});

function startRecording() {
  if (isRecording) return;
  isRecording = true;
  recordedActions = [];
  lastTypedElement = null;
  lastTypedValue = '';
  recordAction({ type: 'navigate', url: location.href, description: `Navigate to ${location.href}` });
  attachListeners();
  showRecordingIndicator();
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  detachListeners();
  hideRecordingIndicator();
  flushTyping();
  port.postMessage({ type: 'RECORDING_COMPLETE', actions: recordedActions });
  recordedActions = [];
}

function recordAction(action) {
  if (!isRecording) return;
  const entry = { ...action, timestamp: Date.now(), url: action.url || location.href };
  recordedActions.push(entry);
  port.postMessage({ type: 'ACTION_RECORDED', action: entry, totalActions: recordedActions.length });
  const countEl = document.getElementById('ab-action-count');
  if (countEl) countEl.textContent = recordedActions.length;
}

// ============ Event Handlers ============

function handleClick(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  flushTyping();
  const el = e.target;
  recordAction({
    type: 'click', locator: getAgentBrowserLocator(el),
    cssSelector: buildSelector(el), description: `Click ${describeElement(el)}`
  });
  highlightElement(el);
}

function handleDblClick(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  const el = e.target;
  recordAction({
    type: 'dblclick', locator: getAgentBrowserLocator(el),
    cssSelector: buildSelector(el), description: `Double-click ${describeElement(el)}`
  });
}

function handleInput(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();

  if (tag === 'select') {
    flushTyping();
    recordAction({
      type: 'select', value: el.value, locator: getAgentBrowserLocator(el),
      cssSelector: buildSelector(el), description: `Select "${el.value}" in ${describeElement(el)}`
    });
    return;
  }

  if (tag === 'input' || tag === 'textarea') {
    const inputType = el.type?.toLowerCase();
    if (inputType === 'checkbox') {
      flushTyping();
      recordAction({
        type: el.checked ? 'check' : 'uncheck', locator: getAgentBrowserLocator(el),
        cssSelector: buildSelector(el), description: `${el.checked ? 'Check' : 'Uncheck'} ${describeElement(el)}`
      });
      return;
    }
    if (inputType === 'radio') {
      flushTyping();
      recordAction({
        type: 'click', locator: getAgentBrowserLocator(el),
        cssSelector: buildSelector(el), description: `Select radio ${describeElement(el)}`
      });
      return;
    }
    if (el !== lastTypedElement) { flushTyping(); lastTypedElement = el; }
    lastTypedValue = el.value;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => flushTyping(), 1500);
  }
}

function flushTyping() {
  if (lastTypedElement && lastTypedValue !== undefined) {
    const el = lastTypedElement;
    recordAction({
      type: 'type', value: lastTypedValue, locator: getAgentBrowserLocator(el),
      cssSelector: buildSelector(el), description: `Type "${lastTypedValue.substring(0, 50)}" into ${describeElement(el)}`
    });
  }
  lastTypedElement = null;
  lastTypedValue = '';
  clearTimeout(typingTimer);
}

function handleKeydown(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  const specialKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'];
  if (specialKeys.includes(e.key)) {
    if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    flushTyping();
    recordAction({ type: 'press', key: e.key, description: `Press ${e.key}` });
  }
}

let scrollTimer = null;
function handleScroll() {
  if (!isRecording) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const st = document.documentElement.scrollTop || document.body.scrollTop;
    const sl = document.documentElement.scrollLeft || document.body.scrollLeft;
    let direction = 'down', amount = Math.round(Math.abs(st));
    if (Math.abs(sl) > Math.abs(st)) { direction = sl > 0 ? 'right' : 'left'; amount = Math.round(Math.abs(sl)); }
    else if (st < 0) direction = 'up';
    recordAction({ type: 'scroll', direction, amount, description: `Scroll ${direction} ${amount}px` });
  }, 300);
}

let hoverTimer = null;
function handleHover(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
    ['button', 'link', 'menuitem', 'tab'].includes(role);
  if (isInteractive) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      recordAction({
        type: 'hover', locator: getAgentBrowserLocator(el),
        cssSelector: buildSelector(el), description: `Hover over ${describeElement(el)}`
      });
    }, 800);
  }
}

function handlePopState() {
  if (!isRecording) return;
  flushTyping();
  const newUrl = location.href;
  if (newUrl !== currentUrl) {
    currentUrl = newUrl;
    recordAction({ type: 'navigate', url: newUrl, description: `Navigate to ${newUrl}` });
  }
}

// ============ Listeners ============

function attachListeners() {
  document.addEventListener('click', handleClick, true);
  document.addEventListener('dblclick', handleDblClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('scroll', handleScroll, true);
  document.addEventListener('mouseover', handleHover, true);
  window.addEventListener('popstate', handlePopState);
}

function detachListeners() {
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('dblclick', handleDblClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('scroll', handleScroll, true);
  document.removeEventListener('mouseover', handleHover, true);
  window.removeEventListener('popstate', handlePopState);
}

// ============ Visual Feedback ============

function showRecordingIndicator() {
  if (document.getElementById('ab-recorder-indicator')) return;
  const indicator = document.createElement('div');
  indicator.id = 'ab-recorder-indicator';
  indicator.innerHTML = '<span class="ab-dot"></span><span class="ab-text">REC</span><span class="ab-count" id="ab-action-count">0</span>';
  document.body.appendChild(indicator);
}

function hideRecordingIndicator() {
  const indicator = document.getElementById('ab-recorder-indicator');
  if (indicator) indicator.remove();
  document.querySelectorAll('.ab-highlight').forEach(el => el.remove());
}

function highlightElement(el) {
  const rect = el.getBoundingClientRect();
  const hl = document.createElement('div');
  hl.className = 'ab-highlight';
  hl.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;border:2px solid rgba(255,59,48,0.8);border-radius:4px;pointer-events:none;z-index:2147483647;transition:opacity 0.3s ease;`;
  document.body.appendChild(hl);
  setTimeout(() => { hl.style.opacity = '0'; setTimeout(() => hl.remove(), 300); }, 600);
}

function isRecorderElement(el) {
  return el.closest('#ab-recorder-indicator') || el.classList.contains('ab-highlight');
}

console.log('[AB Recorder] Content script loaded');
