#!/usr/bin/env node
/**
 * Jenkins UI Server
 * ==================
 * Serves the Jenkins UI static files AND forwards /proxy/* requests to a
 * real Jenkins server with CORS headers so the browser won't block them.
 *
 * No npm install needed – uses only Node.js built-in modules.
 *
 * Usage:
 *   node jenkins-ui/proxy-server.js [port]   (default port: 3000)
 *
 * Then open:
 *   http://localhost:3000
 */

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const PORT   = parseInt(process.argv[2], 10) || 3000;
const UI_DIR = path.join(__dirname); // proxy-server.js lives inside jenkins-ui/

/* -------------------------------------------------------
   MIME types for static file serving
   ------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

/* -------------------------------------------------------
   CORS headers added to every proxied response
   ------------------------------------------------------- */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type', 'Authorization',
    'X-Jenkins-URL', 'X-Jenkins-Username', 'X-Jenkins-Token',
    'Jenkins-Crumb', 'X-Jenkins-Crumb', 'X-Jenkins-Crumb-Field'
  ].join(', '),
  'Access-Control-Expose-Headers': 'X-Jenkins-Session, Location'
};

/* -------------------------------------------------------
   Main request handler
   ------------------------------------------------------- */
const server = http.createServer((req, res) => {

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // /proxy/* → forward to Jenkins
  if (req.url.startsWith('/proxy')) {
    return handleProxy(req, res);
  }

  // Everything else → serve static files from jenkins-ui/
  return serveStatic(req, res);
});

/* -------------------------------------------------------
   Static file server
   ------------------------------------------------------- */
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  try { urlPath = decodeURIComponent(urlPath); } catch (_) {}

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // Prevent directory traversal
  const filePath = path.normalize(path.join(UI_DIR, urlPath));
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + urlPath);
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error: ' + err.message);
      }
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

/* -------------------------------------------------------
   Jenkins proxy handler  (/proxy/... → Jenkins)
   ------------------------------------------------------- */
function handleProxy(req, res) {
  const jenkinsBaseUrl = (req.headers['x-jenkins-url'] || '').replace(/\/$/, '');
  const username       = req.headers['x-jenkins-username'] || '';
  const token          = req.headers['x-jenkins-token']    || '';

  if (!jenkinsBaseUrl) {
    sendJSON(res, 400, {
      error: 'Missing X-Jenkins-URL header. Open http://localhost:' + PORT +
             ' and configure the Jenkins connection in the Settings modal.'
    });
    return;
  }

  const forwardPath = req.url.replace(/^\/proxy/, '') || '/';

  let targetUrl;
  try {
    targetUrl = new URL(forwardPath, jenkinsBaseUrl);
  } catch (e) {
    sendJSON(res, 400, { error: 'Invalid URL: ' + e.message });
    return;
  }

  const upstreamHeaders = {
    'Accept': req.headers['accept'] || 'application/json, text/plain, */*'
  };

  if (req.headers['content-type'])   upstreamHeaders['Content-Type']   = req.headers['content-type'];
  if (req.headers['content-length']) upstreamHeaders['Content-Length'] = req.headers['content-length'];

  if (username && token) {
    upstreamHeaders['Authorization'] =
      'Basic ' + Buffer.from(username + ':' + token).toString('base64');
  }

  // Jenkins CSRF crumb pass-through
  const crumbField = req.headers['x-jenkins-crumb-field'];
  const crumbValue = req.headers['x-jenkins-crumb'] || req.headers['jenkins-crumb'];
  if (crumbField && crumbValue) {
    upstreamHeaders[crumbField] = crumbValue;
  } else if (crumbValue) {
    upstreamHeaders['Jenkins-Crumb'] = crumbValue;
  }

  const isHttps = targetUrl.protocol === 'https:';
  const lib     = isHttps ? https : http;

  const options = {
    hostname:           targetUrl.hostname,
    port:               targetUrl.port || (isHttps ? 443 : 80),
    path:               targetUrl.pathname + targetUrl.search,
    method:             req.method,
    headers:            upstreamHeaders,
    rejectUnauthorized: false   // allow self-signed certs
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const responseHeaders = Object.assign({}, CORS_HEADERS, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream'
    });
    if (proxyRes.headers['location']) {
      responseHeaders['Location'] = proxyRes.headers['location'];
    }
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    sendJSON(res, 502, { error: 'Could not reach Jenkins: ' + err.message });
  });

  req.pipe(proxyReq);
}

/* -------------------------------------------------------
   Helper
   ------------------------------------------------------- */
function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({}, CORS_HEADERS, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }));
  res.end(payload);
}

/* -------------------------------------------------------
   Start
   ------------------------------------------------------- */
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Jenkins UI');
  console.log('  ----------');
  console.log('  Dashboard  →  http://localhost:' + PORT);
  console.log('  Jobs       →  http://localhost:' + PORT + '/jobs.html');
  console.log('');
  console.log('  Click the ⚙ icon to connect to your Jenkins server.');
  console.log('');
});
