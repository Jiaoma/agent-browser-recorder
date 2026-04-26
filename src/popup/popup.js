/**
 * Popup Script — UI controller for the extension popup.
 *
 * Three export formats:
 *   ⚡ .js  (recommended) — Node.js script with JSON-based ref resolution
 *   📄 .sh             — Bash script with grep-based ref resolution
 *   📦 Batch JSON       — agent-browser batch stdin format
 */

// ============ Translator (inlined from src/lib/translator.js) ============

function shellQuote(s){if(!s)return"''";if(/^[a-zA-Z0-9_@:.\/\-]+$/.test(s))return s;return`'${s.replace(/'/g,"'\\''")}'`}
function jsQuote(s){return JSON.stringify(s||'')}

function cmdForSimpleAction(a){switch(a.type){case'navigate':return['open',a.url];case'press':return['press',a.key];case'back':return['back'];case'forward':return['forward'];case'reload':return['reload'];case'scroll':return['scroll',a.direction,String(a.amount||'')];default:return[]}}
function isSimpleAction(t){return['press','back','forward','reload','scroll'].includes(t)}
function getSearchTerm(a,l){if(l&&l.value)return l.value;if(a.description){const m=a.description.match(/"([^"]+)"/);if(m)return m[1]}return''}

function extractTableEvalCode(a){
  const loc=a.tableLocator||{type:'native',tableIndex:a.tableIndex||0};
  const ri=a.rowIndex!=null?a.rowIndex:-1,h=a.headers&&a.headers.length>0;
  let ft;if(loc.type==='aria')ft=`document.querySelectorAll('[role="table"],[role="grid"]')[${loc.tableIndex||0}]`;else if(loc.type==='grid')ft=`document.querySelector(${JSON.stringify(loc.selector)})`;else ft=`document.querySelectorAll('table')[${loc.tableIndex||0}]`;
  if(ri>=0){
    let fr;if(loc.type==='aria')fr=`t.querySelectorAll('[role="row"]')[${ri}]`;else if(loc.type==='grid')fr=`t.children[${ri}]`;else fr=`t.querySelectorAll('tr')[${ri}]`;
    let fc;if(loc.type==='aria')fc=`r.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')`;else if(loc.type==='grid')fc=`r.children`;else fc=`r.querySelectorAll('td,th')`;
    if(h)return`(function(){const t=${ft};if(!t){throw new Error('table not found')}const r=${fr};if(!r){throw new Error('row ${ri} not found')}const cells=Array.from(${fc}).map(c=>c.innerText.trim());const headers=${JSON.stringify(a.headers)};const obj={};headers.forEach((h,i)=>{obj[h]=cells[i]||''});return obj})()`;
    return`(function(){const t=${ft};if(!t){throw new Error('table not found')}const r=${fr};if(!r){throw new Error('row ${ri} not found')}return Array.from(${fc}).map(c=>c.innerText.trim())})()`
  }
  let frs,fcs;if(loc.type==='aria'){frs=`t.querySelectorAll('[role="row"]')`;fcs=`r.querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')`}else if(loc.type==='grid'){frs=`t.children`;fcs=`r.children`}else{frs=`t.querySelectorAll('tr')`;fcs=`r.querySelectorAll('td,th')`}
  return`(function(){const t=${ft};if(!t){throw new Error('table not found')}return Array.from(${frs}).map(r=>Array.from(${fcs}).map(c=>c.innerText.trim()))})()`
}

function translateCommandPreview(action,locator){
  if(action.type==='navigate')return`open ${action.url}`;
  if(action.type==='extract_table'){const i=action.tableIndex||0,r=action.rowIndex!=null?action.rowIndex:0;return`eval → extract table[${i}] row[${r}]`}
  if(isSimpleAction(action.type))return cmdForSimpleAction(action).join(' ');
  const s=getSearchTerm(action,locator),ab={click:'click',dblclick:'dblclick',type:'fill',select:'fill',check:'check',uncheck:'uncheck',hover:'hover',focus:'focus'}[action.type]||'click';
  if(s){if(action.type==='type'||action.type==='select')return`snapshot → @ref(${s}) → fill ${jsQuote(action.value)}`;return`snapshot → @ref(${s}) → ${ab}`}
  return`${ab} ${action.cssSelector||'body'}`
}

function generateJsScript(actions){
  const steps=[];const firstNav=actions.find(a=>a.action.type==='navigate');
  steps.push(`  await ab('close', '--all');`);
  if(firstNav){steps.push(`  await ab('open', ${jsQuote(firstNav.action.url)});`);steps.push(`  await ab('wait', '--load', 'networkidle');`)}
  for(const{action,locator}of actions){
    if(action.type==='navigate')continue;
    if(action.type==='extract_table'){const ec=extractTableEvalCode(action);steps.push(`  data = await abEval(${jsQuote(ec)});`);steps.push(`  log('📊', 'Extracted: ' + JSON.stringify(data));`);continue}
    if(isSimpleAction(action.type)){const cmd=cmdForSimpleAction(action);steps.push(`  await ab(${cmd.map(c=>jsQuote(c)).join(', ')});`);continue}
    const search=getSearchTerm(action,locator);
    const abAction={click:'click',dblclick:'dblclick',type:'fill',select:'fill',check:'check',uncheck:'uncheck',hover:'hover',focus:'focus'}[action.type]||'click';
    const isFill=action.type==='type'||action.type==='select';
    if(search){
      steps.push(`  ref = await findRef(${jsQuote(search)});`);
      steps.push(`  if (ref) {`);
      if(isFill)steps.push(`    await ab(${jsQuote(abAction)}, \`@\${ref}\`, ${jsQuote(action.value)});`);
      else steps.push(`    await ab(${jsQuote(abAction)}, \`@\${ref}\`);`);
      steps.push(`    log('✓', ${jsQuote(abAction+': '+search)});`);
      steps.push(`  } else {`);
      steps.push(`    log('✗', ${jsQuote('Not found: '+search)});`);
      steps.push(`  }`)
    }else{
      const sel=action.cssSelector||'body';
      if(isFill)steps.push(`  await ab('fill', ${jsQuote(sel)}, ${jsQuote(action.value)});`);
      else steps.push(`  await ab(${jsQuote(abAction)}, ${jsQuote(sel)});`)
    }
    if(action.type==='click')steps.push(`  await ab('wait', '--load', 'networkidle');`)
  }
  return`#!/usr/bin/env node
/**
 * Agent Browser Recorder — Auto-generated playback script
 * Generated: ${new Date().toISOString()}
 *
 * Run: node recording.js
 */
const { execSync } = require('child_process');

function ab(...args) {
  const cmd = args.map(a => {
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
  } catch (e) { return null; }
}

function log(icon, msg) { console.log(icon + ' ' + msg); }

async function main() {
  let ref, data;
${steps.join('\n')}
  log('🎬', 'Script complete');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
`}

function generateScript(actions){
  const lines=['#!/bin/bash','# Agent Browser Recorder — Auto-generated script',`# Generated: ${new Date().toISOString()}`,'# Strategy: snapshot → grep ref → act on @ref','','agent-browser close --all 2>/dev/null','','ab_ref() {','  agent-browser snapshot -i 2>/dev/null | grep -i "$1" | head -1 | grep -o "ref=e[0-9]*" | cut -d= -f2','}',''];
  const firstNav=actions.find(a=>a.action.type==='navigate');
  if(firstNav){lines.push(`agent-browser open ${shellQuote(firstNav.action.url)}`);lines.push('agent-browser wait --load networkidle');lines.push('')}
  for(const{action,locator}of actions){
    if(action.type==='navigate')continue;if(action.description)lines.push(`# ${action.description}`);
    if(isSimpleAction(action.type)){lines.push(`agent-browser ${cmdForSimpleAction(action).join(' ')}`);lines.push('');continue}
    const abAction={click:'click',dblclick:'dblclick',type:'fill',select:'fill',check:'check',uncheck:'uncheck',hover:'hover',focus:'focus'}[action.type]||'click';
    const isFill=action.type==='type'||action.type==='select';const search=getSearchTerm(action,locator);
    if(search){lines.push(`REF=$(ab_ref ${shellQuote(search)})`);lines.push('if [ -n "$REF" ]; then');
      if(isFill)lines.push(`  agent-browser fill "@$REF" ${shellQuote(action.value)}`);else lines.push(`  agent-browser ${abAction} "@$REF"`);
      lines.push(`  echo "✓ ${abAction}: ${search.replace(/"/g,'\\"')}"`);lines.push('else');lines.push(`  echo "✗ Not found: ${search.replace(/"/g,'\\"')}"`);lines.push('fi')
    }else{const sel=shellQuote(action.cssSelector||'body');if(isFill)lines.push(`agent-browser fill ${sel} ${shellQuote(action.value)}`);else lines.push(`agent-browser ${abAction} ${sel}`)}
    if(action.type==='click')lines.push('agent-browser wait --load networkidle');lines.push('')}
  lines.push('echo "🎬 Script complete"');return lines.join('\n')
}

function generateBatchCommands(actions){
  const commands=[];const firstNav=actions.find(a=>a.action.type==='navigate');
  if(firstNav){commands.push(['open',firstNav.action.url]);commands.push(['wait','--load','networkidle'])}
  for(const{action,locator}of actions){
    if(action.type==='navigate')continue;if(isSimpleAction(action.type)){commands.push(cmdForSimpleAction(action));continue}
    const abAction={click:'click',dblclick:'dblclick',type:'fill',select:'fill',check:'check',uncheck:'uncheck',hover:'hover',focus:'focus'}[action.type]||'click';
    const isFill=action.type==='type'||action.type==='select';const search=getSearchTerm(action,locator);
    if(search){if(isFill)commands.push(['find','text',search,'fill',action.value]);else commands.push(['find','text',search,abAction])}
    else{if(isFill)commands.push(['fill',action.cssSelector||'body',action.value]);else commands.push([abAction,action.cssSelector||'body'])}
    if(action.type==='click')commands.push(['wait','--load','networkidle'])
  }
  return JSON.stringify(commands,null,2)
}

// ============ Popup Logic ============

const btnRecord=document.getElementById('btnRecord'),btnStop=document.getElementById('btnStop'),btnClear=document.getElementById('btnClear');
const btnExportJS=document.getElementById('btnExportJS'),btnExportShell=document.getElementById('btnExportShell');
const btnExportBatch=document.getElementById('btnExportBatch'),btnCopyCommands=document.getElementById('btnCopyCommands');
const btnReplay=document.getElementById('btnReplay');
const actionList=document.getElementById('actionList'),actionCountEl=document.getElementById('actionCount');
const durationEl=document.getElementById('duration'),statusDot=document.getElementById('statusDot');
const statusText=document.getElementById('statusText'),previewCode=document.getElementById('previewCode');

let actions=[],isRecording=false,startTime=null,durationInterval=null;

btnRecord.addEventListener('click',()=>{if(isRecording)stopRecording();else startRecording()});
btnStop.addEventListener('click',stopRecording);btnClear.addEventListener('click',clearRecording);
btnExportJS.addEventListener('click',()=>downloadExport('js'));
btnExportShell.addEventListener('click',()=>downloadExport('shell'));
btnExportBatch.addEventListener('click',()=>downloadExport('batch'));
btnCopyCommands.addEventListener('click',copyCommands);
btnReplay.addEventListener('click',replayScript);

chrome.runtime.onMessage.addListener(msg=>{
  if(msg.type==='ACTION_RECORDED'){actions.push(msg.action);addActionToList(msg.action);actionCountEl.textContent=actions.length;updatePreview();updateExportButtons()}
});

loadState();

async function loadState(){
  try{const state=await sendMsg({type:'GET_STATE'});if(!state)return;isRecording=state.isRecording;startTime=state.startTime;
    if(isRecording){setRecordingUI(true);startDurationTimer()}
    const result=await sendMsg({type:'GET_ACTIONS'});if(result&&result.actions&&result.actions.length>0){actions=result.actions;renderActionList();actionCountEl.textContent=actions.length;updatePreview()}
    updateExportButtons()
  }catch(e){console.error('[AB Recorder] loadState error:',e)}
}

function sendMsg(msg){return new Promise(r=>{chrome.runtime.sendMessage(msg,resp=>{if(chrome.runtime.lastError)r(null);else r(resp)})})}

async function startRecording(){await sendMsg({type:'START_RECORDING'});isRecording=true;startTime=Date.now();actions=[];setRecordingUI(true);startDurationTimer();renderActionList();updatePreview();updateExportButtons()}
async function stopRecording(){await sendMsg({type:'STOP_RECORDING'});isRecording=false;const r=await sendMsg({type:'GET_ACTIONS'});if(r&&r.actions)actions=r.actions;setRecordingUI(false);stopDurationTimer();renderActionList();actionCountEl.textContent=actions.length;updatePreview();updateExportButtons()}
async function clearRecording(){await sendMsg({type:'CLEAR_ACTIONS'});actions=[];renderActionList();actionCountEl.textContent='0';previewCode.textContent='// Start recording to see script here';updateExportButtons()}

function setRecordingUI(rec){btnRecord.disabled=rec;btnStop.disabled=!rec;btnClear.disabled=rec;
  if(rec){statusDot.classList.add('recording');statusText.textContent='Recording...';btnRecord.classList.add('recording')}
  else{statusDot.classList.remove('recording');statusText.textContent=actions.length>0?`${actions.length} actions`:'Ready';btnRecord.classList.remove('recording')}
}
function startDurationTimer(){stopDurationTimer();durationInterval=setInterval(()=>{const s=Math.floor((Date.now()-startTime)/1000);durationEl.textContent=`${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`},1000)}
function stopDurationTimer(){if(durationInterval)clearInterval(durationInterval);durationInterval=null}
function updateExportButtons(){const h=actions.length>0;btnExportJS.disabled=!h;btnExportShell.disabled=!h;btnExportBatch.disabled=!h;btnCopyCommands.disabled=!h;btnReplay.disabled=!h}

function renderActionList(){actionList.innerHTML='';
  if(actions.length===0){actionList.innerHTML='<div class="empty-state"><span class="empty-icon">🎬</span><p>Click <strong>Record</strong> to start capturing</p><p class="hint">Shortcut: Cmd+Shift+R</p></div>';return}
  actions.forEach(a=>addActionToList(a))
}

const iconMap={click:'👆',dblclick:'👆👆',type:'⌨️',select:'📋',check:'✅',uncheck:'⬜',hover:'🖐',press:'⌨️',navigate:'🔗',scroll:'📜',extract_table:'📊'};

function addActionToList(action){
  const empty=actionList.querySelector('.empty-state');if(empty)empty.remove();
  const item=document.createElement('div');item.className='action-item';const locator=action.locator||{};
  item.innerHTML=`<div class="action-icon ${action.type}">${iconMap[action.type]||'❓'}</div><div class="action-details"><div class="action-type">${action.type}</div><div class="action-desc">${escapeHtml(action.description||'')}</div><div class="action-command">${escapeHtml(translateCommandPreview(action,locator))}</div></div>`;
  actionList.appendChild(item);actionList.scrollTop=actionList.scrollHeight
}

function updatePreview(){
  if(actions.length===0){previewCode.textContent='// Start recording to see script here';return}
  const wrapped=actions.map(a=>({action:a,locator:a.locator||{}}));previewCode.textContent=generateJsScript(wrapped)
}

function downloadExport(format){
  if(actions.length===0)return;const wrapped=actions.map(a=>({action:a,locator:a.locator||{}}));
  let content,filename;
  if(format==='js'){content=generateJsScript(wrapped);filename='recording.js'}
  else if(format==='shell'){content=generateScript(wrapped);filename='recording.sh'}
  else{content=generateBatchCommands(wrapped);filename='recording-batch.json'}
  const url=URL.createObjectURL(new Blob([content],{type:'text/plain'}));
  chrome.downloads.download({url,filename,saveAs:false},id=>{
    if(chrome.runtime.lastError){window.open(url,'_blank')}
    else{const btn=format==='js'?btnExportJS:format==='shell'?btnExportShell:btnExportBatch;const orig=btn.textContent;btn.textContent='✅ Saved!';setTimeout(()=>{btn.textContent=orig},2000)}
  })
}

async function copyCommands(){
  if(actions.length===0)return;const wrapped=actions.map(a=>({action:a,locator:a.locator||{}}));
  try{await navigator.clipboard.writeText(generateJsScript(wrapped));btnCopyCommands.textContent='✅ Copied!';setTimeout(()=>{btnCopyCommands.textContent='📋 Copy .js Script'},2000)}
  catch(e){console.error('Copy failed:',e)}
}

function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

async function replayScript(){
  if(actions.length===0)return;
  const wrapped=actions.map(a=>({action:a,locator:a.locator||{}}));
  const script=generateJsScript(wrapped);
  const filename='recording-replay.js';
  const url=URL.createObjectURL(new Blob([script],{type:'text/plain'}));
  chrome.downloads.download({url,filename,saveAs:false},async(id)=>{
    if(chrome.runtime.lastError){
      // Fallback: just copy the script
      try{await navigator.clipboard.writeText(script);btnReplay.textContent='📋 Copied!';setTimeout(()=>{btnReplay.textContent='▶️ Replay'},2000)}catch(e){}
      return;
    }
    // Copy the run command to clipboard
    const cmd='node ~/Downloads/recording-replay.js';
    try{
      await navigator.clipboard.writeText(cmd);
      btnReplay.textContent='✅ Saved & Copied cmd!';
      setTimeout(()=>{btnReplay.textContent='▶️ Replay'},3000);
    }catch(e){
      btnReplay.textContent='✅ Saved!';
      setTimeout(()=>{btnReplay.textContent='▶️ Replay'},2000);
    }
  });
}
