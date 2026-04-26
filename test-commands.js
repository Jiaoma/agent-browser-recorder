#!/usr/bin/env node
/**
 * Test suite for agent-browser-recorder.
 * Tests translator logic + script generation + live execution.
 */

const { execSync } = require('child_process');
const { generateScript, translateCommandPreview, shellQuote } = require('./src/lib/translator');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}: ${e.message}`); failed++; }
}
function assertEqual(a, b) { if (a !== b) throw new Error(`Expected: ${b}\n    Actual:   ${a}`); }
function assertIncludes(s, n) { if (!s.includes(n)) throw new Error(`Missing: ${n}\n    In: ${s.substring(0, 200)}`); }

function runAb(args) {
  try { return { ok: true, output: execSync(`agent-browser ${args} 2>&1`, { timeout: 15000, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, output: ((e.stdout || '') + (e.stderr || '')).trim() }; }
}

// ============ Unit Tests ============

console.log('\n🧪 Unit Tests: Script Generation\n');

test('generateScript includes ab_ref helper', () => {
  const script = generateScript([
    { action: { type: 'click', cssSelector: 'a', description: 'Click link' }, locator: { strategy: 'text', value: 'Learn more' } }
  ]);
  assertIncludes(script, 'ab_ref()');
  assertIncludes(script, 'agent-browser snapshot -i');
  assertIncludes(script, 'grep -i');
  assertIncludes(script, 'ref=e[0-9]*');
});

test('generateScript uses @ref for element actions', () => {
  const script = generateScript([
    { action: { type: 'navigate', url: 'http://example.com', description: 'Go' }, locator: null },
    { action: { type: 'click', cssSelector: 'a', description: 'Click link' }, locator: { strategy: 'text', value: 'Learn more' } },
  ]);
  assertIncludes(script, "REF=$(ab_ref 'Learn more')");
  assertIncludes(script, 'agent-browser click "@$REF"');
  assertIncludes(script, 'agent-browser wait --load networkidle');
});

test('generateScript handles type actions', () => {
  const script = generateScript([
    { action: { type: 'navigate', url: 'http://example.com', description: 'Go' }, locator: null },
    { action: { type: 'type', value: 'hello', cssSelector: 'input', description: 'Type' }, locator: { strategy: 'text', value: 'Search' } }
  ]);
  assertIncludes(script, "REF=$(ab_ref Search)");
  assertIncludes(script, 'agent-browser fill "@$REF" hello');
});

test('generateScript handles simple actions without ref', () => {
  const script = generateScript([
    { action: { type: 'press', key: 'Enter', description: 'Press Enter' }, locator: null },
    { action: { type: 'scroll', direction: 'down', amount: 500, description: 'Scroll' }, locator: null },
  ]);
  assertIncludes(script, 'agent-browser press Enter');
  assertIncludes(script, 'agent-browser scroll down 500');
});

test('preview commands still use find text for display', () => {
  const cmd = translateCommandPreview(
    { type: 'click', cssSelector: 'a', description: 'Click link' },
    { strategy: 'text', value: 'Learn more' }
  );
  assertEqual(cmd, "agent-browser find text 'Learn more' click");
});

// ============ Live Test: Execute Generated Script ============

console.log('\n🧪 Live Test: Execute generated script on example.com\n');

test('generated script runs successfully', () => {
  // Generate script
  const actions = [
    { action: { type: 'navigate', url: 'https://example.com', description: 'Open example.com' }, locator: null },
    { action: { type: 'click', cssSelector: 'a', description: 'Click "Learn more" link' }, locator: { strategy: 'text', value: 'Learn more' } },
  ];
  const script = generateScript(actions);
  console.log('    Generated script:');
  script.split('\n').forEach(l => console.log(`      ${l}`));

  // Execute it
  const result = execSync(`bash -c '${script.replace(/'/g, "'\\''")}' 2>&1`, { timeout: 30000, encoding: 'utf8' });
  console.log(`    Output: ${result.trim()}`);

  if (result.includes('✗ Not found')) throw new Error('Element not found during execution');
  if (result.includes('✓') || result.includes('Done')) {
    // Success
  } else {
    throw new Error(`Unexpected output: ${result}`);
  }
});

// Cleanup
runAb('close');

// ============ Summary ============

console.log(`\n${'═'.repeat(50)}`);
if (failed === 0) console.log(`✅ All ${passed} tests passed!`);
else console.log(`❌ ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50) + '\n');

if (failed > 0) process.exit(1);
