/**
 * Translator — Convert recorded actions to agent-browser CLI commands.
 *
 * Locator strategies → command format:
 *   testid:      agent-browser find testid <id> <action>
 *   label:       agent-browser find label <text> <action>
 *   placeholder: agent-browser find placeholder <text> <action>
 *   text:        agent-browser find text <text> <action>
 *   css:         agent-browser <action> <selector>
 */

function shellQuote(str) {
  if (!str) return "''";
  if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function translateCommand(action, locator) {
  // Selector-less actions
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

  // Action name mapping
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

if (typeof module !== 'undefined') module.exports = { translateCommand, generateScript, shellQuote };
