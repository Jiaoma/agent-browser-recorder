/**
 * Translator — Generate bash scripts that use snapshot-based ref resolution.
 *
 * Every element action follows: snapshot → grep for target text → extract ref → act on @ref.
 * This is the most reliable strategy because it uses agent-browser's own
 * accessibility tree, which matches exactly what agent-browser can interact with.
 *
 * The generated script includes a helper function `ab_ref` that does:
 *   agent-browser snapshot -i | grep "search text" | extract ref
 */

function shellQuote(str) {
  if (!str) return "''";
  if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function generateScript(actions) {
  const lines = [
    '#!/bin/bash',
    '# Agent Browser Recorder — Auto-generated script',
    `# Generated: ${new Date().toISOString()}`,
    '#',
    '# Strategy: snapshot → grep ref → act on @ref',
    '# Each action re-snapshots to get fresh refs (refs change after page updates).',
    '',
    '# Helper: get ref by searching snapshot for a text string',
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

    // Simple actions (no element targeting needed)
    if (['press', 'back', 'forward', 'reload', 'scroll'].includes(action.type)) {
      lines.push(cmdForSimpleAction(action));
      lines.push('');
      continue;
    }

    // Element actions: find ref → act
    const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                       check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
    const isFill = action.type === 'type' || action.type === 'select';

    // Determine search term: locator value is best, then extract from description
    let search = '';
    if (locator && locator.value) {
      search = locator.value;
    } else if (action.description) {
      // Extract quoted text or last meaningful word
      const m = action.description.match(/"([^"]+)"/);
      if (m) search = m[1];
    }

    if (search && search.length > 0) {
      lines.push(`REF=$(ab_ref ${shellQuote(search)})`);
      lines.push('if [ -n "$REF" ]; then');
      if (isFill) {
        lines.push(`  agent-browser fill "@$REF" ${shellQuote(action.value)}`);
      } else {
        lines.push(`  agent-browser ${abAction} "@$REF"`);
      }
      lines.push(`  echo "✓ ${abAction}: ${search.replace(/"/g, '\\"')}"`);
      lines.push('else');
      lines.push(`  echo "✗ Not found in snapshot: ${search.replace(/"/g, '\\"')}"`);
      lines.push('fi');
    } else {
      // Fallback: CSS selector
      const sel = shellQuote(action.cssSelector || 'body');
      if (isFill) {
        lines.push(`agent-browser fill ${sel} ${shellQuote(action.value)}`);
      } else {
        lines.push(`agent-browser ${abAction} ${sel}`);
      }
    }

    // Wait after clicks (page might change)
    if (action.type === 'click') lines.push('agent-browser wait --load networkidle');
    lines.push('');
  }

  lines.push('echo "🎬 Script complete"');
  return lines.join('\n');
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

// Preview command (for popup display — simpler, no snapshot logic)
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

if (typeof module !== 'undefined') module.exports = { generateScript, translateCommandPreview, shellQuote };
