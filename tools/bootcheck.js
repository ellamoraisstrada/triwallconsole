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

const store = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp,
  Error, TypeError, Map, Set, WeakMap, isNaN, parseInt, parseFloat, encodeURIComponent,
  decodeURIComponent, URL, Intl,
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
  document: new Proxy({}, {
    get(t, k) {
      if (k === 'documentElement' || k === 'body' || k === 'head') return stub('document.' + String(k));
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

let failed = false;
try {
  vm.createContext(sandbox);
  new vm.Script(m[1], { filename: file }).runInContext(sandbox, { timeout: 15000 });
  console.log('  script ran to completion with no load-time exception');
} catch (e) {
  failed = true;
  console.log('  LOAD-TIME EXCEPTION: ' + e.message);
  const line = (e.stack || '').split('\n').find(l => l.includes(file));
  if (line) console.log('    at ' + line.trim());
}
process.exit(failed ? 1 : 0);
