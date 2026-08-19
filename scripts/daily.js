const { execFileSync } = require('child_process');
const path = require('path');

const node = process.execPath;
const scripts = path.join(__dirname);

console.log('=== Daily strategy update', new Date().toISOString(), '===');
try {
  console.log('1/2 Fetching market data...');
  execFileSync(node, [path.join(scripts, 'fetch.js')], { stdio: 'inherit', timeout: 600000 });
} catch (e) {
  console.error('Data fetch failed (will retry tomorrow):', e.message);
}
try {
  console.log('2/2 Computing strategy signals...');
  execFileSync(node, [path.join(scripts, 'tracker.js')], { stdio: 'inherit', timeout: 120000 });
} catch (e) {
  console.error('Signal computation failed:', e.message);
}
try {
  console.log('3/3 Computing trade setups...');
  execFileSync(node, [path.join(scripts, 'setups.js')], { stdio: 'inherit', timeout: 120000 });
} catch (e) {
  console.error('Setup computation failed:', e.message);
}
try {
  console.log('4/4 Precomputing static page data...');
  execFileSync(node, [path.join(scripts, 'precompute.js')], { stdio: 'inherit', timeout: 300000 });
} catch (e) {
  console.error('Static data precompute failed:', e.message);
}
console.log('=== Done ===');
