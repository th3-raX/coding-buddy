/**
 * Local development server.
 * Mimics the Vercel environment: serves static files from /public
 * and routes /api/* to serverless functions in /api/.
 *
 * Usage: node dev-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8').replace(/^\uFEFF/, '');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        process.env[key] = value;
      }
    }
  }
}

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── API Routes ──────────────────────────────────────────────────────────
  if (url.pathname.startsWith('/api/')) {
    const fnName = url.pathname.replace('/api/', '').replace(/\/$/, '');
    const fnPath = path.join(__dirname, 'api', `${fnName}.js`);

    if (!fs.existsSync(fnPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'API route not found' }));
    }

    // Parse body for POST
    let body = '';
    if (req.method === 'POST') {
      await new Promise((resolve) => {
        req.on('data', (chunk) => (body += chunk));
        req.on('end', resolve);
      });
      try {
        req.body = JSON.parse(body);
      } catch {
        req.body = body;
      }
    }

    // Simulate Vercel's req/res interface
    const mockRes = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        res.writeHead(this.statusCode, {
          ...this.headers,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify(data));
      },
    };

    try {
      // Clear require cache for hot-reload during dev
      delete require.cache[require.resolve(fnPath)];
      const handler = require(fnPath);
      await handler(req, mockRes);
    } catch (err) {
      console.error('API error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    return;
  }

  // ── Static Files ────────────────────────────────────────────────────────
  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Code Review Assistant\n  → http://localhost:${PORT}\n`);
});
