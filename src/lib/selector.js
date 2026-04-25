/**
 * Selector Builder — Generate robust CSS selectors for DOM elements.
 * Prioritizes: id > data-testid > unique attributes > structural path
 */

/**
 * Build the best CSS selector for a given element.
 */
export function buildSelector(el) {
  if (!el || el === document.body || el === document.documentElement) {
    return 'body';
  }

  // 1. ID selector
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  // 2. data-testid
  if (el.dataset.testid) {
    return `[data-testid="${CSS.escape(el.dataset.testid)}"]`;
  }

  // 3. Unique name attribute (for form elements)
  if (el.name && el.tagName !== 'DIV') {
    const byName = document.querySelectorAll(`[name="${CSS.escape(el.name)}"]`);
    if (byName.length === 1) {
      return `[name="${CSS.escape(el.name)}"]`;
    }
  }

  // 4. Unique class combination + tag
  const tag = el.tagName.toLowerCase();
  if (el.classList.length > 0) {
    const classSelector = `${tag}.${Array.from(el.classList).map(c => CSS.escape(c)).join('.')}`;
    if (document.querySelectorAll(classSelector).length === 1) {
      return classSelector;
    }
  }

  // 5. ARIA role + name
  const role = el.getAttribute('role');
  const ariaLabel = el.getAttribute('aria-label');
  if (role && ariaLabel) {
    const ariaSelector = `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`;
    if (document.querySelectorAll(ariaSelector).length === 1) {
      return ariaSelector;
    }
  }

  // 6. Placeholder (for inputs)
  if (el.placeholder) {
    const phSelector = `${tag}[placeholder="${CSS.escape(el.placeholder)}"]`;
    if (document.querySelectorAll(phSelector).length === 1) {
      return phSelector;
    }
  }

  // 7. Link text (for <a> tags)
  if (tag === 'a' && el.textContent.trim()) {
    const text = el.textContent.trim().substring(0, 50);
    // Will use find text command instead
    return null; // Signal to use text-based finding
  }

  // 8. Build structural path
  return buildStructuralPath(el);
}

/**
 * Build a structural CSS path (nth-child chain).
 */
function buildStructuralPath(el) {
  const parts = [];
  let current = el;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

/**
 * Get a human-readable description of an element for display.
 */
export function describeElement(el) {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || '').trim().substring(0, 60);
  const ariaLabel = el.getAttribute('aria-label');
  const placeholder = el.placeholder;
  const name = el.name;
  const href = el.href ? new URL(el.href, location.href).pathname : null;

  const parts = [`<${tag}>`];

  if (el.id) parts.push(`#${el.id}`);
  if (name) parts.push(`name="${name}"`);
  if (ariaLabel) parts.push(`aria="${ariaLabel}"`);
  if (placeholder) parts.push(`placeholder="${placeholder}"`);
  if (text && text.length < 40) parts.push(`"${text}"`);
  if (href) parts.push(`→ ${href}`);

  return parts.join(' ');
}

/**
 * Get the best agent-browser selector strategy for an element.
 * Returns { type: 'css'|'text'|'role'|'label'|'placeholder'|'testid', value: string }
 */
export function getAgentBrowserLocator(el) {
  // data-testid → find testid
  if (el.dataset.testid) {
    return { type: 'testid', value: el.dataset.testid };
  }

  // ARIA role + name → find role
  const role = el.getAttribute('role') || getImplicitRole(el);
  const ariaLabel = el.getAttribute('aria-label');
  const accessibleName = ariaLabel || getTextContent(el);

  if (role && accessibleName) {
    return { type: 'role', role, value: accessibleName };
  }

  // Label association (for form elements)
  if (el.labels && el.labels.length > 0) {
    const labelText = el.labels[0].textContent.trim();
    if (labelText) {
      return { type: 'label', value: labelText };
    }
  }

  // Placeholder (for inputs)
  if (el.placeholder) {
    return { type: 'placeholder', value: el.placeholder };
  }

  // Link/button text
  const text = getTextContent(el);
  if (text && (el.tagName === 'A' || el.tagName === 'BUTTON' || role === 'button')) {
    return { type: 'text', value: text };
  }

  // Fallback to CSS
  const css = buildSelector(el);
  return { type: 'css', value: css };
}

function getImplicitRole(el) {
  const tag = el.tagName.toLowerCase();
  const type = el.type?.toLowerCase();
  const roleMap = {
    button: 'button',
    a: 'link',
    input: type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' ? 'button' : 'textbox',
    select: 'combobox',
    textarea: 'textbox',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    form: 'form',
    table: 'table',
    ul: 'list',
    ol: 'list',
  };
  return roleMap[tag] || null;
}

function getTextContent(el) {
  // Get direct text, not nested children's text
  const text = (el.textContent || '').trim();
  if (text.length <= 80) return text;
  return text.substring(0, 80);
}
