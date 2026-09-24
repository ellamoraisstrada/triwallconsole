// LOAD-TIME SMOKE TEST for index.html's main script.
//
// checkhtml.js proves the file PARSES. That is not enough: a `let` read before
// its declaration parses perfectly and throws the moment the line runs. That is
// exactly what shipped - setMode() runs during page load, reached a `let` two
// thousand lines further down, threw, and silently killed every line after it.
// The only visible symptom was an unrelated button failing later.
//
// So this runs the script against a permissive stub DOM and reports whether it
// reaches the end. It cannot prove the page WORKS - the stub is not a browser -
// but anything that throws on the way down is a real bug, and this is the only
// cheap way to see it without a headless browser.
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2] || 'index.html';
const html = fs.readFileSync(file, 'utf8');
const m = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.log('no script block found'); process.exit(1); }

// A stub that answers to anything: property reads give another stub, calls give
// another stub, and it coerces to '' / 0 / false so ordinary string and number
// work does not explode.
function stub(name) {
  const fn = function () { return stub(name + '()'); };
  fn.__stub = name;
  return new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;                 // not a thenable
      if (k === Symbol.iterator) return function* () {};  // spreads/for..of
      if (k === 'length') return 0;
      if (k === 'toString') return () => '';
      if (k === 'valueOf') return () => '';
      if (k in t && typeof t[k] !== 'undefined' && k !== 'name') return t[k];
      return stub(name + '.' + String(k));
    },
    set() { return true; },
    apply() { return stub(name + '()'); },
    has() { return true; },
  });
}

// ---- just enough real DOM for buildTabs() ---------------------------------
// buildTabs walks the top-level children of .wrap in order and assigns each to a
// tab. A stub with no children makes it fail every time, which means the stub
// can never tell a broken tab layout from a working one - and a broken tab
// layout is exactly what shipped. So the top-level children are parsed out of
// the real HTML and given just enough behaviour for that walk to run.
function parseTopLevel(html) {
  const start = html.indexOf('<div class="wrap"');
  if (start < 0) return [];
  const open = html.indexOf('>', start) + 1;
  const VOID = new Set(['br','img','input','hr','meta','link','source','track','area','base','col','embed','param','wbr']);
  const tag = /<(\/?)(\w+)([^>]*)>/g;
  tag.lastIndex = open;
  let depth = 1, m;
  const out = [];
  while ((m = tag.exec(html))) {
    const [, slash, name, attrs] = m;
    if (VOID.has(name) || attrs.endsWith('/')) continue;
    if (!slash) {
      if (depth === 1) {
        out.push({ id: (attrs.match(/id="([^"]+)"/) || [])[1] || '',
                   cls: (attrs.match(/class="([^"]+)"/) || [])[1] || '' });
      }
      depth++;
    } else if (--depth === 0) break;
  }
  return out;
}
function el(id, cls) {
  const node = {
    id: id || '', hidden: false, style: {}, dataset: {}, type: '', textContent: '',
    className: cls || '',
    classList: {
      _s: new Set((cls || '').split(/\s+/).filter(Boolean)),
      contains(c) { return this._s.has(c); },
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); },
    },
    children: [], parentNode: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertAdjacentElement(_pos, c) { c.parentNode = this; return c; },
    insertAdjacentHTML() {},
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return stub('el.querySelector(' + sel + ')'); },
    querySelectorAll() { return []; },
    prepend() {}, before() {}, after() {}, replaceWith() {}, closest() { return null; },
    setAttribute() {}, getAttribute() { return null; }, remove() {},
    focus() {}, click() {}, scrollIntoView() {},
  };
  return node;
}

const store = {};
// The page catches a failed tab build and only console.errors it, so the page
// still "loads" while collapsing into one scroll. That is exactly what shipped,
// so the message is treated as a failure here rather than noise.
const errors = [];
const tapConsole = Object.create(console);
tapConsole.error = (...a) => { errors.push(a.map(String).join(' ')); };
tapConsole.warn = () => {};

const sandbox = {
  console: tapConsole,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp,
  Error, TypeError, Map, Set, WeakMap, isNaN, parseInt, parseFloat, encodeURIComponent,
  decodeURIComponent, URL, Intl,
  sessionStorage: {
    getItem: k => (k in store ? store['s:' + k] || null : null),
    setItem: (k, v) => { store['s:' + k] = String(v); },
    removeItem: k => { delete store['s:' + k]; },
  },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}),
                                 text: () => Promise.resolve('') }),
  requestAnimationFrame: cb => setTimeout(cb, 0),
  FileReader: function () { return stub('FileReader'); },
  FormData: function () { return stub('FormData'); },
  Image: function () { return stub('Image'); },
  navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'node' },
  location: { href: 'http://localhost:8934/', search: '', hash: '', reload: () => {} },
  history: stub('history'),
  alert: () => {}, confirm: () => true, prompt: () => '',
  scrollTo: () => {}, scrollBy: () => {}, getComputedStyle: () => ({}),
  matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  document: new Proxy({}, {
    get(t, k) {
      if (k === 'documentElement' || k === 'body' || k === 'head') return stub('document.' + String(k));
      if (k === 'querySelector') return sel => (sel === '.wrap' ? WRAP : stub('qs(' + sel + ')'));
      if (k === 'createElement') return () => el('', '');
      if (k === 'querySelectorAll') return () => [];
      // Every id resolves to a stub rather than null. Returning null is the
      // honest browser answer for ids that are absent, but it stops the script
      // at the first `el.innerHTML = ...` and the point here is to get all the
      // way DOWN the file looking for load-time throws.
      if (k === 'getElementById') return () => stub('#el');
      if (k === 'createElement') return () => stub('el');
      if (k === 'addEventListener') return () => {};
      if (k === 'readyState') return 'complete';
      return stub('document.' + String(k));
    },
  }),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const WRAP = el('', 'wrap');
parseTopLevel(html).forEach(c => WRAP.appendChild(el(c.id, c.cls)));

let failed = false;
try {
  vm.createContext(sandbox);
  new vm.Script(m[1], { filename: file }).runInContext(sandbox, { timeout: 15000 });
  console.log('  script ran to completion with no load-time exception');
  const tab = errors.find(e => /tab layout failed/.test(e));
  if (tab) { failed = true; console.log('  TAB LAYOUT BROKEN: ' + tab); }
  else { console.log('  tab layout built'); }
  errors.filter(e => !/tab layout failed/.test(e)).slice(0, 4)
        .forEach(e => console.log('  (console.error) ' + e.slice(0, 120)));
} catch (e) {
  failed = true;
  console.log('  LOAD-TIME EXCEPTION: ' + e.message);
  const line = (e.stack || '').split('\n').find(l => l.includes(file));
  if (line) console.log('    at ' + line.trim());
}
process.exit(failed ? 1 : 0);
