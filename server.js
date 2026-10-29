// Static file server for the v2 status page. v1's live API endpoints
// (/api/setups, /api/paper, /api/track, /api/autopsy, /api/asset, /api/equity)
// were deleted with the v1 strategy on 2026-10-29.
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, 'web');
const PORT = process.env.PORT || 8899;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const file = path.join(WEB, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`Dashboard running: http://localhost:${PORT}`));
