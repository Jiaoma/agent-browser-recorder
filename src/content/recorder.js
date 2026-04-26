/**
 * Content Script — Records user interactions on the page.
 * Generates agent-browser compatible commands using find text/label/placeholder/testid.
 */

// ============ Selector Utilities ============

function buildSelector(el) {
  try {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.dataset && el.dataset.testid) return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
    if (el.name && el.tagName !== 'DIV') {
      const byName = document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
      if (byName.length === 1) return `[name="${CSS.escape(el.name)}"]`;
    }
    const tag = el.tagName.toLowerCase();
    if (el.classList && el.classList.length > 0) {
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
  } catch (e) {
    console.warn('[AB Recorder] buildSelector error:', e);
    return 'body';
  }
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
      if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function describeElement(el) {
  try {
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
  } catch (e) {
    return '<unknown>';
  }
}

function getElementText(el) {
  try {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'summary', 'label', 'div', 'li', 'td', 'option'].includes(tag)) {
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3) // Node.TEXT_NODE
        .map(n => n.textContent.trim())
        .filter(t => t.length > 0)
        .join(' ')
        .trim();
      if (directText) return directText.substring(0, 80);
      const fullText = (el.textContent || '').trim();
      if (fullText) return fullText.substring(0, 80);
    }

    if (el.title) return el.title.trim();
    return null;
  } catch (e) {
    return null;
  }
}

function buildLocator(el) {
  try {
    // 1. data-testid
    if (el.dataset && el.dataset.testid) {
      return { strategy: 'testid', value: el.dataset.testid };
    }
    // 2. Label association
    if (el.labels && el.labels.length > 0) {
      const labelText = el.labels[0].textContent.trim();
      if (labelText) return { strategy: 'label', value: labelText };
    }
    // 3. Placeholder
    if (el.placeholder) {
      return { strategy: 'placeholder', value: el.placeholder };
    }
    // 4. Text content
    const text = getElementText(el);
    if (text && text.length > 0) {
      return { strategy: 'text', value: text };
    }
    // 5. CSS fallback
    return { strategy: 'css', value: buildSelector(el) };
  } catch (e) {
    console.warn('[AB Recorder] buildLocator error:', e);
    return { strategy: 'css', value: buildSelector(el) || 'body' };
  }
}

// ============ Recording State ============

let isRecording = false;
let lastTypedElement = null;
let lastTypedValue = '';
let typingTimer = null;
let currentUrl = location.href;

// ============ Message Handling ============

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING':
      startRecording();
      sendResponse({ success: true });
      break;
    case 'STOP_RECORDING':
      stopRecording();
      sendResponse({ success: true });
      break;
    case 'PING':
      sendResponse({ alive: true, isRecording });
      break;
  }
  return true;
});

// ============ Recording Logic ============

function startRecording() {
  if (isRecording) return;
  isRecording = true;
  lastTypedElement = null;
  lastTypedValue = '';
  console.log('[AB Recorder] ✅ Recording started');
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
  console.log('[AB Recorder] ⏹ Recording stopped');
}

function recordAction(action) {
  if (!isRecording) return;

  // Build locator BEFORE creating the entry (so we never send DOM refs)
  let locator = null;
  if (action.elementInfo) {
    locator = buildLocator(action.elementInfo);
  }

  const entry = {
    type: action.type,
    timestamp: Date.now(),
    url: action.url || location.href,
    cssSelector: action.cssSelector,
    description: action.description,
    locator: locator,
  };

  // Copy action-specific fields (not elementInfo)
  if (action.value !== undefined) entry.value = action.value;
  if (action.key !== undefined) entry.key = action.key;
  if (action.direction !== undefined) entry.direction = action.direction;
  if (action.amount !== undefined) entry.amount = action.amount;

  console.log('[AB Recorder] Action:', entry.type, entry.description || '');

  // Send to background (never include DOM references)
  try {
    chrome.runtime.sendMessage({ type: 'ACTION_RECORDED', action: entry });
  } catch (e) {
    console.warn('[AB Recorder] sendMessage failed:', e);
  }

  // Update on-page counter
  const countEl = document.getElementById('ab-action-count');
  if (countEl) {
    const current = parseInt(countEl.textContent) || 0;
    countEl.textContent = current + 1;
  }
}

// ============ Event Handlers ============

function handleClick(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  // Ignore clicks that were actually drag operations on the indicator
  if (abDrag.moved) { abDrag.moved = false; return; }
  flushTyping();
  const el = e.target;
  recordAction({
    type: 'click',
    elementInfo: el,
    cssSelector: buildSelector(el),
    description: `Click ${describeElement(el)}`
  });
  highlightElement(el);
}

function handleDblClick(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  const el = e.target;
  recordAction({
    type: 'dblclick',
    elementInfo: el,
    cssSelector: buildSelector(el),
    description: `Double-click ${describeElement(el)}`
  });
}

function handleInput(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  const el = e.target;
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    flushTyping();
    recordAction({
      type: 'select', value: el.value,
      elementInfo: el, cssSelector: buildSelector(el),
      description: `Select "${el.value}" in ${describeElement(el)}`
    });
    return;
  }
  if (tag === 'input' || tag === 'textarea') {
    const inputType = (el.type || '').toLowerCase();
    if (inputType === 'checkbox') {
      flushTyping();
      recordAction({
        type: el.checked ? 'check' : 'uncheck',
        elementInfo: el, cssSelector: buildSelector(el),
        description: `${el.checked ? 'Check' : 'Uncheck'} ${describeElement(el)}`
      });
      return;
    }
    if (inputType === 'radio') {
      flushTyping();
      recordAction({
        type: 'click',
        elementInfo: el, cssSelector: buildSelector(el),
        description: `Select radio ${describeElement(el)}`
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
    recordAction({
      type: 'type', value: lastTypedValue,
      elementInfo: lastTypedElement, cssSelector: buildSelector(lastTypedElement),
      description: `Type into ${describeElement(lastTypedElement)}`
    });
  }
  lastTypedElement = null;
  lastTypedValue = '';
  clearTimeout(typingTimer);
}

function handleKeydown(e) {
  if (!isRecording || isRecorderElement(e.target)) return;
  if (['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'].includes(e.key)) {
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
  const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(tag) || ['button', 'link', 'menuitem', 'tab'].includes(role);
  if (isInteractive) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      recordAction({
        type: 'hover',
        elementInfo: el, cssSelector: buildSelector(el),
        description: `Hover over ${describeElement(el)}`
      });
    }, 800);
  }
}

function handlePopState() {
  if (!isRecording) return;
  flushTyping();
  const newUrl = location.href;
  if (newUrl !== currentUrl) { currentUrl = newUrl; recordAction({ type: 'navigate', url: newUrl, description: `Navigate to ${newUrl}` }); }
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

// Drag state for the recording indicator
let abDrag = { active: false, startX: 0, startY: 0, startLeft: 0, startTop: 0, moved: false };

function showRecordingIndicator() {
  if (document.getElementById('ab-recorder-indicator')) return;
  const el = document.createElement('div');
  el.id = 'ab-recorder-indicator';
  el.innerHTML = '<span class="ab-dot"></span><span class="ab-text">REC</span><span class="ab-count" id="ab-action-count">0</span>';
  document.body.appendChild(el);

  // Make it draggable
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    abDrag = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    };
    el.classList.add('ab-dragging');
  });

  document.addEventListener('mousemove', (e) => {
    if (!abDrag.active) return;
    e.preventDefault();
    const dx = e.clientX - abDrag.startX;
    const dy = e.clientY - abDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) abDrag.moved = true;
    const newLeft = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, abDrag.startLeft + dx));
    const newTop = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, abDrag.startTop + dy));
    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';
    el.style.right = 'auto'; // clear default right:16px
  });

  document.addEventListener('mouseup', () => {
    if (!abDrag.active) return;
    abDrag.active = false;
    el.classList.remove('ab-dragging');
  });
}

function hideRecordingIndicator() {
  const el = document.getElementById('ab-recorder-indicator');
  if (el) el.remove();
  document.querySelectorAll('.ab-highlight').forEach(e => e.remove());
  abDrag.active = false;
}

function highlightElement(el) {
  try {
    const rect = el.getBoundingClientRect();
    const hl = document.createElement('div');
    hl.className = 'ab-highlight';
    hl.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;border:2px solid rgba(255,59,48,0.8);border-radius:4px;pointer-events:none;z-index:2147483647;transition:opacity 0.3s ease;`;
    document.body.appendChild(hl);
    setTimeout(() => { hl.style.opacity = '0'; setTimeout(() => hl.remove(), 300); }, 600);
  } catch (e) {}
}

function isRecorderElement(el) {
  try {
    return !!(el.closest('#ab-recorder-indicator') || el.classList.contains('ab-highlight'));
  } catch (e) { return false; }
}

console.log('[AB Recorder] Content script loaded v1.2.0');

// Visual diagnostic: add a small badge to confirm injection
(function() {
  const badge = document.createElement('div');
  badge.id = 'ab-loaded-badge';
  badge.textContent = '🦀 AB Ready';
  badge.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;padding:4px 10px;background:rgba(0,0,0,0.7);color:#fff;font:11px system-ui;border-radius:12px;pointer-events:none;opacity:1;transition:opacity 2s ease 3s;';
  document.body.appendChild(badge);
  setTimeout(() => { badge.style.opacity = '0'; setTimeout(() => badge.remove(), 3000); }, 100);
})();
