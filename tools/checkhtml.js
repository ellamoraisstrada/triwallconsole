// Parse EVERY <script> block in the page separately. The page has two, and a
// span from the first <script> to the last </script> swallows the close tag of
// the first plus the open tag of the second - which is why every syntax check
// in this session reported "Unexpected token '<'" even on a known-good file.
const fs = require('fs');
const vm = require('vm');
const file = process.argv[2] || 'index.html';
const h = fs.readFileSync(file, 'utf8');
const re = /<script>([\s\S]*?)<\/script>/g;
let m, n = 0, bad = 0;
while ((m = re.exec(h))) {
  n++;
  const upto = h.slice(0, m.index).split('\n').length;
  try {
    new vm.Script(m[1], { filename: file + ' block ' + n });
    console.log('  block ' + n + ' (line ' + upto + ', ' + m[1].length + ' chars): parses OK');
  } catch (e) {
    bad++;
    console.log('  block ' + n + ' (line ' + upto + '): ' + e.message);
  }
}
console.log(n + ' script block(s), ' + bad + ' with syntax errors');
process.exit(bad ? 1 : 0);
