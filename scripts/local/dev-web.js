const fs = require('fs');
const http = require('http');
const path = require('path');

require('./load-env.cjs');

const root = path.resolve(__dirname, '..', '..');
const webRoot = path.join(root, 'apps', 'web', 'html');
const port = positiveInt('WEB_PORT', process.env.WEB_PORT || '3100');
const apiPort = positiveInt('API_PORT', process.env.API_PORT || '3000');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function positiveInt(name, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function insideWebRoot(file) {
  return file === webRoot || file.startsWith(webRoot + path.sep);
}

function staticFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return '';
  }
  if (decoded.includes('\0')) return '';
  const relative = decoded.replace(/^\/+/, '');
  const full = path.resolve(webRoot, relative);
  if (!insideWebRoot(full)) return '';
  return full;
}

function sendFile(res, file) {
  const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-cache',
  });
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
}

function sendIndex(res) {
  sendFile(res, path.join(webRoot, 'index.html'));
}

function proxyApi(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${apiPort}` };
  delete headers.connection;
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: apiPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      const responseHeaders = { ...up.headers };
      delete responseHeaders.connection;
      delete responseHeaders['transfer-encoding'];
      delete responseHeaders['content-length'];
      res.writeHead(up.statusCode || 502, responseHeaders);
      up.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('api unavailable\n');
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const file = staticFile(url.pathname);
  if (!file) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad path\n');
    return;
  }
  fs.stat(file, (error, stat) => {
    if (!error && stat.isFile()) {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'content-type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-cache',
        });
        res.end();
        return;
      }
      sendFile(res, file);
      return;
    }
    if (!error && stat.isDirectory()) {
      const index = path.join(file, 'index.html');
      if (fs.existsSync(index)) {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-cache' });
          res.end();
          return;
        }
        sendFile(res, index);
        return;
      }
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-cache' });
      res.end();
      return;
    }
    sendIndex(res);
  });
});

server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`интерфейс http://127.0.0.1:${port} -> api http://127.0.0.1:${apiPort}`);
});
