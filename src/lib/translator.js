/**
 * Translator — Generate scripts for agent-browser playback.
 *
 * Three export formats:
 *   1. .js  — Node.js script (recommended)
 *   2. .sh  — Bash script with ab_ref helper
 *   3. .json — agent-browser batch format
 *
 * Supports action types:
 *   navigate, click, dblclick, type, select, check, uncheck, hover, focus,
 *   press, back, forward, reload, scroll, extract_table
 *
 * extract_table uses `agent-browser eval --stdin` to extract structured data.
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
  if (action.type === 'extract_table') {
    const idx = action.tableIndex !== undefined ? action.tableIndex : 0;
    const row = action.rowIndex !== undefined ? action.rowIndex : 0;
    return `eval → extract table[${idx}] row[${row}]`;
  }
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

// ============ extract_table JS generator ============

function extractTableEvalCode(action) {
  const locator = action.tableLocator || { type: 'native', tableIndex: action.tableIndex || 0 };
  const rowIdx = action.rowIndex !== undefined ? action.rowIndex : -1;
  const hasHeaders = action.headers && action.headers.length > 0;

  // Build the JS to find the table element
  let findTable;
  if (locator.type === 'aria') {
    findTable = `document.querySelectorAll('[role="table"],[role="grid"]')[${locator.tableIndex || 0}]`;
  } else if (locator.type === 'grid') {
    // Use the recorded CSS selector
    findTable = `document.querySelector(${JSON.stringify(locator.selector)})`;
  } else {
    // native
    findTable = `document.querySelectorAll('table')[${locator.tableIndex || 0}]`;
  }

  if (rowIdx >= 0) {
    // Extract specific row
    let findRow;
    if (locator.type === 'aria') {
      findRow = `t.querySelectorAll('[role="row"]')[${rowIdx}]`;
    } else if (locator.type === 'grid') {
      findRow = `t.children[${rowIdx}]`;
    } else {
      findRow = `t.querySelectorAll('tr')[${rowIdx}]`;
    }
    let findCells;
    if (locator.type === 'aria') {
      findCells = `r.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')`;
    } else if (locator.type === 'grid') {
      findCells = `r.children`;
    } else {
      findCells = `r.querySelectorAll('td,th')`;
    }

    if (hasHeaders) {
      return `(function(){const t=${findTable};if(!t){throw new Error('table not found')}const r=${findRow};if(!r){throw new Error('row ${rowIdx} not found')}const cells=Array.from(${findCells}).map(c=>c.innerText.trim());const headers=${JSON.stringify(action.headers)};const obj={};headers.forEach((h,i)=>{obj[h]=cells[i]||''});return obj})()`;
    }
    return `(function(){const t=${findTable};if(!t){throw new Error('table not found')}const r=${findRow};if(!r){throw new Error('row ${rowIdx} not found')}return Array.from(${findCells}).map(c=>c.innerText.trim())})()`;
  }

  // Extract entire table
  let findRows, findCellsAll;
  if (locator.type === 'aria') {
    findRows = `t.querySelectorAll('[role="row"]')`;
    findCellsAll = `r.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')`;
  } else if (locator.type === 'grid') {
    findRows = `t.children`;
    findCellsAll = `r.children`;
  } else {
    findRows = `t.querySelectorAll('tr')`;
    findCellsAll = `r.querySelectorAll('td,th')`;
  }
  return `(function(){const t=${findTable};if(!t){throw new Error('table not found')}return Array.from(${findRows}).map(r=>Array.from(${findCellsAll}).map(c=>c.innerText.trim()))})()`;
}

function extractAllTablesEvalCode() {
  return `Array.from(document.querySelectorAll('table')).map(t=>({` +
    `headers:Array.from(t.querySelectorAll('th')).map(c=>c.innerText.trim),` +
    `rows:Array.from(t.querySelectorAll('tbody tr, tr')).map(r=>` +
    `Array.from(r.querySelectorAll('td')).map(c=>c.innerText.trim))` +
    `}));`;
}

// ============ .js Script (Node.js — recommended) ============

function generateJsScript(actions) {
  const steps = [];
  const firstNav = actions.find(a => a.action.type === 'navigate');

  // Start clean — close any existing browser sessions
  steps.push(`  await ab('close', '--all');`);

  if (firstNav) {
    steps.push(`  await ab('open', ${jsQuote(firstNav.action.url)});`);
    steps.push(`  await ab('wait', '--load', 'networkidle');`);
  }

  for (const { action, locator } of actions) {
    if (action.type === 'navigate') continue;

    // extract_table
    if (action.type === 'extract_table') {
      const evalCode = extractTableEvalCode(action);
      steps.push(`  data = await abEval(${jsQuote(evalCode)});`);
      steps.push(`  log('📊', 'Extracted: ' + JSON.stringify(data));`);
      continue;
    }

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
 * Run: node recording.js
 *
 * AUTH OPTIONS (uncomment one):
 *   // Option A: Reuse Chrome login state (requires Chrome closed)
 *   // execSync('agent-browser --profile Default open about:blank');
 *   // Option B: Save/restore auth state after manual login
 *   //   1. agent-browser open https://example.com && login manually
 *   //   2. agent-browser state save ./auth.json
 *   //   3. Uncomment: execSync('agent-browser state load ./auth.json');
 *   // Option C: Connect to running Chrome with auth
 *   //   agent-browser --auto-connect ... (requires Chrome with --remote-debugging-port)
 */

const { execSync } = require('child_process');

// ===== AUTH CONFIG — uncomment & edit if your page requires login =====
// const AUTH_STATE = './auth.json';  // Path to saved state file
// if (AUTH_STATE) { execSync('agent-browser state load ' + AUTH_STATE); }
// =====================================================================

function ab(...args) {
  const cmd = args.map(a => {
    // Shell-escape each argument to prevent & and other special chars
    const s = String(a);
    if (/^[a-zA-Z0-9_@:.\/\-]+$/.test(s)) return s;
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }).join(' ');
  try {
    const out = execSync('agent-browser ' + cmd, { encoding: 'utf8', timeout: 15000 });
    process.stdout.write(out);
    return out;
  } catch (e) {
    if (e.stdout) process.stdout.write(e.stdout);
    throw e;
  }
}

function abEval(jsCode) {
  // Use argument mode (not --stdin) for reliability
  const result = execSync('agent-browser eval ' + JSON.stringify(jsCode), {
    encoding: 'utf8', timeout: 20000
  });
  try { return JSON.parse(result); } catch { return result; }
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
  let ref, data;
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
    'agent-browser close --all 2>/dev/null',
    'ab_ref() {',
    '  agent-browser snapshot -i 2>/dev/null | grep -i "$1" | head -1 | grep -o "ref=e[0-9]*" | cut -d= -f2',
    '}',
    '',
    'ab_eval() {',
    '  agent-browser eval "$1"',
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

    if (action.type === 'extract_table') {
      const evalCode = extractTableEvalCode(action);
      lines.push(`ab_eval ${shellQuote(evalCode)}`);
      lines.push(''); continue;
    }

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

    if (action.type === 'extract_table') {
      const evalCode = extractTableEvalCode(action);
      commands.push(['eval', '--stdin', evalCode]);
      continue;
    }

    if (isSimpleAction(action.type)) { commands.push(cmdForSimpleAction(action)); continue; }
    const abAction = { click:'click', dblclick:'dblclick', type:'fill', select:'fill',
                       check:'check', uncheck:'uncheck', hover:'hover', focus:'focus' }[action.type] || 'click';
    const isFill = action.type === 'type' || action.type === 'select';
    const search = getSearchTerm(action, locator);
    if (search) {
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
