#!/usr/bin/env node
/**
 * Test suite for agent-browser-recorder.
 * Unit tests for translator + live tests against example.com.
 */

const { execSync } = require('child_process');
const { translateCommand, generateScript } = require('./src/lib/translator');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
}
function assertEqual(a, b) { if (a !== b) throw new Error(`Expected: ${b}\n    Actual:   ${a}`); }
function assertIncludes(s, n) { if (!s.includes(n)) throw new Error(`Missing: ${n}\n    In: ${s}`); }

function runAb(args) {
  try { return { ok: true, output: execSync(`agent-browser ${args} 2>&1`, { timeout: 15000, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, output: ((e.stdout || '') + (e.stderr || '')).trim() }; }
}

// ============ Unit Tests ============

console.log('\n🧪 Unit Tests\n');

test('navigate → open', () => assertEqual(translateCommand({ type: 'navigate', url: 'http://example.com' }, null), 'agent-browser open http://example.com'));
test('click by text', () => assertEqual(translateCommand({ type: 'click', cssSelector: 'a' }, { strategy: 'text', value: 'Learn more' }), "agent-browser find text 'Learn more' click"));
test('click by testid', () => assertEqual(translateCommand({ type: 'click', cssSelector: 'btn' }, { strategy: 'testid', value: 'submit' }), 'agent-browser find testid submit click'));
test('type by label', () => assertEqual(translateCommand({ type: 'type', value: 'hi', cssSelector: 'in' }, { strategy: 'label', value: 'Email' }), 'agent-browser find label Email fill hi'));
test('type by placeholder', () => assertEqual(translateCommand({ type: 'type', value: 'q', cssSelector: 'in' }, { strategy: 'placeholder', value: 'Search...' }), "agent-browser find placeholder Search... fill q"));
test('type by text', () => assertEqual(translateCommand({ type: 'type', value: 'test', cssSelector: 'in' }, { strategy: 'text', value: 'Username' }), "agent-browser find text Username fill test"));
test('hover by text', () => assertEqual(translateCommand({ type: 'hover', cssSelector: 'a' }, { strategy: 'text', value: '概览' }), "agent-browser find text '概览' hover"));
test('check by label', () => assertEqual(translateCommand({ type: 'check', cssSelector: 'in' }, { strategy: 'label', value: 'Remember me' }), "agent-browser find label 'Remember me' check"));
test('uncheck by label', () => assertEqual(translateCommand({ type: 'uncheck', cssSelector: 'in' }, { strategy: 'label', value: 'Remember me' }), "agent-browser find label 'Remember me' uncheck"));
test('CSS fallback click', () => assertEqual(translateCommand({ type: 'click', cssSelector: '#btn' }, { strategy: 'css', value: '#btn' }), "agent-browser click '#btn'"));
test('CSS fallback fill', () => assertEqual(translateCommand({ type: 'type', value: 'hi', cssSelector: 'input[name=q]' }, { strategy: 'css', value: 'input[name=q]' }), "agent-browser fill 'input[name=q]' hi"));
test('press key', () => assertEqual(translateCommand({ type: 'press', key: 'Enter' }, null), 'agent-browser press Enter'));
test('scroll', () => assertEqual(translateCommand({ type: 'scroll', direction: 'down', amount: 500 }, null), 'agent-browser scroll down 500'));
test('back/forward/reload', () => {
  assertEqual(translateCommand({ type: 'back' }, null), 'agent-browser back');
  assertEqual(translateCommand({ type: 'forward' }, null), 'agent-browser forward');
  assertEqual(translateCommand({ type: 'reload' }, null), 'agent-browser reload');
});
test('no locator → cssSelector', () => assertEqual(translateCommand({ type: 'click', cssSelector: '.btn' }, null), "agent-browser click .btn"));

// ============ Script Gen ============

console.log('\n🧪 Script Generation\n');

test('full script generation', () => {
  const actions = [
    { action: { type: 'navigate', url: 'http://example.com', description: 'Go' }, locator: null },
    { action: { type: 'click', cssSelector: 'a', description: 'Click link' }, locator: { strategy: 'text', value: 'Learn more' } },
    { action: { type: 'type', value: 'test', cssSelector: 'input', description: 'Type' }, locator: { strategy: 'placeholder', value: 'Search' } },
  ];
  const script = generateScript(actions);
  assertIncludes(script, 'agent-browser open http://example.com');
  assertIncludes(script, 'agent-browser wait --load networkidle');
  assertIncludes(script, 'agent-browser snapshot -i');
  assertIncludes(script, "agent-browser find text 'Learn more' click");
  assertIncludes(script, "agent-browser find placeholder Search fill test");
  assertIncludes(script, '# Click link');
  assertIncludes(script, '# End of recorded script');
});

// ============ Live Tests ============

console.log('\n🧪 Live Tests: example.com\n');

test('open page', () => { const r = runAb('open https://example.com'); if (!r.ok) throw new Error(r.output); });
test('wait for load', () => { const r = runAb('wait --load networkidle'); if (!r.ok) throw new Error(r.output); });
test('snapshot', () => {
  const r = runAb('snapshot -i');
  if (!r.ok || r.output.length < 20) throw new Error('snapshot failed or too short');
  console.log(`    (${r.output.split('\n').length} interactive elements)`);
});

test('find text "Learn more" click → navigates', () => {
  const r = runAb('find text "Learn more" click');
  if (!r.ok) throw new Error(r.output);
  if (r.output.toLowerCase().includes('not found')) throw new Error('Element not found');
});

test('verify navigation happened', () => {
  const r = runAb('get url');
  if (!r.ok) throw new Error(r.output);
  if (!r.output.includes('iana.org')) throw new Error(`Expected iana.org URL, got: ${r.output}`);
});

test('go back', () => {
  const r = runAb('back');
  if (!r.ok) throw new Error(r.output);
});

test('find text "Example Domain" click', () => {
  const r = runAb('find text "Example Domain" click');
  if (!r.ok) throw new Error(r.output);
  if (r.output.toLowerCase().includes('not found')) throw new Error('Element not found');
});

runAb('close');

// ============ Summary ============

console.log(`\n${'═'.repeat(50)}`);
if (failed === 0) console.log(`✅ All ${passed} tests passed!`);
else console.log(`❌ ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50) + '\n');

if (failed > 0) process.exit(1);
