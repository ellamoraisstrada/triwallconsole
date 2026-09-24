// RENDER CHECK - the only test here that is not a guess.
//
// checkhtml.js proves the page parses. bootcheck.js runs it against a stub DOM
// and catches load-time throws. Both were passing while the page was, in fact,
// rendering as one long scroll with no tabs - because a stub is not a browser,
// and every time the stub disagreed with reality I trusted the stub.
//
// This drives the real thing: Edge, headless, against the running server, and
// reads the DOM *after* the page's javascript has run. If the tab bar is not in
// that DOM, the tabs are not there.
//
//   node tools/rendercheck.js [url]
//
// Needs Edge (present on this machine by default) and the console running.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2] || 'http://localhost:8934/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

if (!EDGE) {
  console.log('  Edge not found - skipping the render check (this is the only');
  console.log('  test that proves the page actually works; do not treat a skip');
  console.log('  as a pass).');
  process.exit(0);
}

// A throwaway profile, and the cache off: a stale copy is exactly the thing
// that makes this test lie, and it has already done so once.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'triwall-render-'));
let dom = '';
try {
  dom = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--disable-http-cache',
    '--virtual-time-budget=10000', '--user-data-dir=' + profile,
    '--dump-dom', url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now(),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.log('  could not render the page: ' + (e.message || e).slice(0, 160));
  process.exit(1);
}
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

let bad = 0;
function T(label, pass, detail) {
  if (!pass) bad++;
  console.log('  ' + (pass ? 'ok  ' : 'FAIL') + '  ' + label + (detail ? '   [' + detail + ']' : ''));
}

// The page writes the first uncaught error into the title when one is installed;
// short of that, an empty tab bar is the symptom that matters.
const tabs = [...dom.matchAll(/<button[^>]*class="tabbtn[^"]*"[^>]*>([^<]*)/g)].map(m => m[1].trim());
const panels = [...new Set([...dom.matchAll(/id="(tabpanel-[a-z]+)"/g)].map(m => m[1]))];

T('the page rendered', dom.length > 1000, dom.length + ' bytes');
T('the tab bar exists', tabs.length > 0, tabs.length ? tabs.join(', ') : 'NO TABS - the page is one scroll');
T('all six tabs are present', tabs.length === 6, tabs.length + ' found');
T('every tab has a panel', panels.length === 6, panels.join(' '));
T('wall cards rendered', /id="imgprompt-center"/.test(dom));

console.log(bad ? '\n  ' + bad + ' FAILED' : '\n  the page renders as a tabbed layout');
process.exit(bad ? 1 : 0);
