/**
 * Translator — Generate scripts for agent-browser playback.
 *
 * Three export formats:
 *   1. .sh  — Bash script with ab_ref helper (snapshot → grep → @ref)
 *   2. .json — agent-browser batch format (direct execution via stdin)
 *   3. .js  — Node.js script (most reliable: snapshot → JSON parse → @ref → act)
 *
 * The .js format is recommended because it uses agent-browser's --json output
 * to programmatically find the correct ref, matching the snapshot-and-ref workflow
 * described in agent-browser's core skill.
 */

function shellQuote(str) {
  if (!str) return "''";
  if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function jsQuote(str) {
  return JSON.stringify(str || '');
}

function cmdForSimpleAction(action) {
  switch (action.type) {
    case 'navigate': return ['open', action.url];
    case 'press': return ['press', action.key];
    case 'back': return ['back'];
    case 'forward': return ['forward'];
    case 'reload': return ['reload'];
    case 'scroll': return ['scroll', action.direction, String(action.amount || '')];
    default: return [];
  }
}

function isSimpleAction(type) {
  return ['press', 'back', 'forward', 'reload', 'scroll'].includes(type);
}

function getSearchTerm(action, locator) {
  if (locator && locator.value) return locator.value;
  if (action.description) {
    const m = action.description.match(/"([^"]+)"/);
    if (m) return m[1];
  }
  return '';
}

// ============ Preview (for popup list items) ============

function translateCommandPreview(action, locator) {
  if (action.type === 'navigate') return `open ${action.url}`;
  if (isSimpleAction(action.type)) return cmdForSimpleAction(action).join(' ');
  const search = getSearchTerm(action, locator);
  const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                     check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
  if (search) {
    if (action.type === 'type' || action.type === 'select')
      return `snapshot → @ref(${search}) → fill ${jsQuote(action.value)}`;
    return `snapshot → @ref(${search}) → ${abAction}`;
  }
  return `${abAction} ${action.cssSelector || 'body'}`;
}

// ============ .js Script (Node.js — recommended) ============

function generateJsScript(actions) {
  const steps = [];
  const firstNav = actions.find(a => a.action.type === 'navigate');

  if (firstNav) {
    steps.push(`  await ab('open', ${jsQuote(firstNav.action.url)});`);
    steps.push(`  await ab('wait', '--load', 'networkidle');`);
  }

  for (const { action, locator } of actions) {
    if (action.type === 'navigate') continue;

    if (isSimpleAction(action.type)) {
      const cmd = cmdForSimpleAction(action);
      steps.push(`  await ab(${cmd.map(c => jsQuote(c)).join(', ')});`);
      continue;
    }

    const search = getSearchTerm(action, locator);
    const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                       check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
    const isFill = action.type === 'type' || action.type === 'select';

    if (search) {
      steps.push(`  ref = await findRef(${jsQuote(search)});`);
      steps.push(`  if (ref) {`);
      if (isFill) {
        steps.push(`    await ab(${jsQuote(abAction)}, \`@\${ref}\`, ${jsQuote(action.value)});`);
      } else {
        steps.push(`    await ab(${jsQuote(abAction)}, \`@\${ref}\`);`);
      }
      steps.push(`    log('✓', ${jsQuote(abAction + ': ' + search)});`);
      steps.push(`  } else {`);
      steps.push(`    log('✗', ${jsQuote('Not found: ' + search)});`);
      steps.push(`  }`);
    } else {
      const sel = action.cssSelector || 'body';
      if (isFill) {
        steps.push(`  await ab('fill', ${jsQuote(sel)}, ${jsQuote(action.value)});`);
      } else {
        steps.push(`  await ab(${jsQuote(abAction)}, ${jsQuote(sel)});`);
      }
    }

    if (action.type === 'click') {
      steps.push(`  await ab('wait', '--load', 'networkidle');`);
    }
  }

  return `#!/usr/bin/env node
/**
 * Agent Browser Recorder — Auto-generated playback script
 * Generated: ${new Date().toISOString()}
 *
 * Strategy: snapshot → parse JSON → find @ref → act
 * Run: node recording.js
 */

const { execSync } = require('child_process');

function ab(...args) {
  const cmd = args.join(' ');
  try {
    const out = execSync('agent-browser ' + cmd, { encoding: 'utf8', timeout: 15000 });
    process.stdout.write(out);
    return out;
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout);
    throw e;
  }
}

function findRef(searchText) {
  try {
    const out = execSync('agent-browser snapshot -i --json', { encoding: 'utf8', timeout: 10000 });
    const data = JSON.parse(out);
    const refs = data.data?.refs || {};
    for (const [ref, info] of Object.entries(refs)) {
      const name = info.name || '';
      const role = info.role || '';
      if (name.toLowerCase().includes(searchText.toLowerCase()) ||
          (role && searchText.toLowerCase() === role.toLowerCase())) {
        return ref;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function log(icon, msg) {
  console.log(icon + ' ' + msg);
}

async function main() {
  let ref;
${steps.join('\n')}
  log('🎬', 'Script complete');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
`;
}

// ============ .sh Script (Bash) ============

function generateScript(actions) {
  const lines = [
    '#!/bin/bash',
    '# Agent Browser Recorder — Auto-generated script',
    `# Generated: ${new Date().toISOString()}`,
    '# Strategy: snapshot → grep ref → act on @ref',
    '',
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
    if (isSimpleAction(action.type)) {
      lines.push(`agent-browser ${cmdForSimpleAction(action).join(' ')}`);
      lines.push(''); continue;
    }
    const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                       check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
    const isFill = action.type === 'type' || action.type === 'select';
    const search = getSearchTerm(action, locator);
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

// ============ .json Batch ============

function generateBatchCommands(actions) {
  const commands = [];
  const firstNav = actions.find(a => a.action.type === 'navigate');
  if (firstNav) { commands.push(['open', firstNav.action.url]); commands.push(['wait','--load','networkidle']); }
  for (const { action, locator } of actions) {
    if (action.type === 'navigate') continue;
    if (isSimpleAction(action.type)) { commands.push(cmdForSimpleAction(action)); continue; }
    const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                       check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
    const isFill = action.type === 'type' || action.type === 'select';
    const search = getSearchTerm(action, locator);
    if (search) {
      // Batch can't do dynamic ref lookup, so include a comment/note
      // Use find text as fallback for batch mode
      if (isFill) commands.push(['find', 'text', search, 'fill', action.value]);
      else commands.push(['find', 'text', search, abAction]);
    } else {
      if (isFill) commands.push(['fill', action.cssSelector || 'body', action.value]);
      else commands.push([abAction, action.cssSelector || 'body']);
    }
    if (action.type === 'click') commands.push(['wait', '--load', 'networkidle']);
  }
  return JSON.stringify(commands, null, 2);
}

if (typeof module !== 'undefined') module.exports = { generateScript, generateJsScript, generateBatchCommands, translateCommandPreview, shellQuote };
