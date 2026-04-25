/**
 * Command Translator — Convert recorded actions into agent-browser CLI commands.
 */

/**
 * Translate a recorded action into an agent-browser CLI command string.
 * @param {Object} action - The recorded action
 * @param {Object} locator - The agent-browser locator from selector.js
 * @returns {string} agent-browser CLI command
 */
export function translateCommand(action, locator) {
  const sel = formatSelector(locator);

  switch (action.type) {
    case 'click':
      return `agent-browser click ${sel}`;

    case 'dblclick':
      return `agent-browser dblclick ${sel}`;

    case 'type':
      return `agent-browser fill ${sel} ${shellQuote(action.value)}`;

    case 'select':
      return `agent-browser select ${sel} ${shellQuote(action.value)}`;

    case 'check':
      return `agent-browser check ${sel}`;

    case 'uncheck':
      return `agent-browser uncheck ${sel}`;

    case 'hover':
      return `agent-browser hover ${sel}`;

    case 'focus':
      return `agent-browser focus ${sel}`;

    case 'scroll':
      return `agent-browser scroll ${action.direction} ${action.amount || ''}`.trim();

    case 'scroll_into_view':
      return `agent-browser scrollintoview ${sel}`;

    case 'press':
      return `agent-browser press ${action.key}`;

    case 'navigate':
      return `agent-browser open ${shellQuote(action.url)}`;

    case 'back':
      return `agent-browser back`;

    case 'forward':
      return `agent-browser forward`;

    case 'reload':
      return `agent-browser reload`;

    case 'tab_new':
      return `agent-browser tab new ${action.url ? shellQuote(action.url) : ''}`.trim();

    case 'tab_close':
      return `agent-browser tab close`;

    case 'tab_switch':
      return `agent-browser tab ${action.tabId || ''}`;

    default:
      return `# Unknown action: ${action.type}`;
  }
}

/**
 * Format a locator into an agent-browser selector argument.
 */
function formatSelector(locator) {
  if (!locator) return '@unknown';

  switch (locator.type) {
    case 'testid':
      return `find testid ${shellQuote(locator.value)} click`;

    case 'role':
      if (locator.role) {
        return `find role ${locator.role} click${locator.value ? ` --name ${shellQuote(locator.value)}` : ''}`;
      }
      return `find text ${shellQuote(locator.value)} click`;

    case 'label':
      return `find label ${shellQuote(locator.value)}`;

    case 'placeholder':
      return `find placeholder ${shellQuote(locator.value)}`;

    case 'text':
      return `find text ${shellQuote(locator.value)} click`;

    case 'css':
    default:
      return shellQuote(locator.value);
  }
}

/**
 * Shell-quote a string value.
 */
function shellQuote(str) {
  if (!str) return "''";
  // If it contains no special characters, no quoting needed
  if (/^[a-zA-Z0-9_@:.\/-]+$/.test(str)) {
    return str;
  }
  // Use single quotes, escaping any internal single quotes
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Generate a complete script from a list of recorded actions.
 * @param {Array} actions - Array of { action, locator } objects
 * @param {Object} options - { url: string, headless: boolean }
 * @returns {string} Complete shell script
 */
export function generateScript(actions, options = {}) {
  const lines = ['#!/bin/bash', '# Agent Browser Recorder - Auto-generated script', `# Generated: ${new Date().toISOString()}`, ''];

  // Open the initial URL
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) {
    lines.push(`agent-browser open ${shellQuote(firstNav.action.url)}`);
    lines.push('agent-browser wait --load networkidle');
    lines.push('');
  }

  let lastActionWasNav = !!firstNav;

  for (const { action, locator } of actions) {
    // Skip the first navigation (already handled above)
    if (action === firstNav?.action && action.type === 'navigate') continue;

    // Add snapshot before interactions for discoverability
    if (!lastActionWasNav && isInteraction(action.type)) {
      // Optionally add a snapshot for context
    }

    const cmd = translateCommand(action, locator);

    // Add comment with human-readable description
    if (action.description) {
      lines.push(`# ${action.description}`);
    }

    lines.push(cmd);

    // Add waits after navigation
    if (action.type === 'navigate' || action.type === 'click') {
      lines.push('agent-browser wait 500');
    }

    lastActionWasNav = action.type === 'navigate';
  }

  lines.push('');
  lines.push('# End of recorded script');

  return lines.join('\n');
}

function isInteraction(type) {
  return ['click', 'dblclick', 'type', 'fill', 'select', 'check', 'uncheck', 'hover'].includes(type);
}

/**
 * Generate a batch JSON command for agent-browser batch execution.
 */
export function generateBatchCommands(actions) {
  const commands = [];
  const firstNav = actions.find(a => a.action.type === 'navigate');

  if (firstNav) {
    commands.push(['open', firstNav.action.url]);
    commands.push(['wait', '--load', 'networkidle']);
  }

  for (const { action, locator } of actions) {
    if (action === firstNav?.action && action.type === 'navigate') continue;
    const cmd = translateCommand(action, locator);
    // Parse the command string into array
    commands.push(parseCommandToArray(cmd));
  }

  return JSON.stringify(commands, null, 2);
}

function parseCommandToArray(cmdStr) {
  // Remove "agent-browser " prefix
  const stripped = cmdStr.replace(/^agent-browser\s+/, '');
  // Simple tokenization (doesn't handle all edge cases)
  const tokens = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of stripped) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) tokens.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  return tokens;
}
