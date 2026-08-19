const { execFileSync } = require('child_process');
const path = require('path');

const node = process.execPath;
const scripts = path.join(__dirname);

console.log('=== Hourly setup update', new Date().toISOString(), '===');
try {
  execFileSync(node, [path.join(scripts, 'fetch.js')], { stdio: 'inherit', timeout: 600000 });
} catch (e) {
  console.error('Data fetch failed:', e.message);
}
try {
  execFileSync(node, [path.join(scripts, 'setups.js')], { stdio: 'inherit', timeout: 120000 });
} catch (e) {
  console.error('Setup computation failed:', e.message);
}
try {
  execFileSync(node, [path.join(scripts, 'precompute.js')], { stdio: 'inherit', timeout: 300000 });
} catch (e) {
  console.error('Static data precompute failed:', e.message);
}
console.log('=== Done ===');