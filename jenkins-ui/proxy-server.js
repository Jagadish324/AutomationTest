#!/usr/bin/env node
/**
 * Jenkins UI Proxy Server
 * ========================
 * Forwards browser requests to a real Jenkins server and injects CORS headers,
 * so the Jenkins UI frontend can talk to Jenkins without browser CORS errors.
 *
 * No npm install needed – uses only Node.js built-in modules.
 *
 * Usage:
 *   node proxy-server.js [port]     (default port: 3000)
 *
 * Then open:
 *   jenkins-ui/index.html  and set Jenkins URL in the Settings panel.
 */

'use strict';

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = parseInt(process.argv[2], 10) || 3000;

/* -------------------------------------------------------
   CORS headers added to every response
   ------------------------------------------------------- */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type', 'Authorization',
    'X-Jenkins-URL', 'X-Jenkins-Username', 'X-Jenkins-Token',
    'Jenkins-Crumb', 'X-Jenkins-Crumb'
  ].join(', '),
  'Access-Control-Expose-Headers': 'X-Jenkins-Session, Location'
};

/* -------------------------------------------------------
   Request handler
   ------------------------------------------------------- */
const server = http.createServer((req, res) => {

  // ── Preflight ──────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // ── Read Jenkins connection info from custom headers ───
  const jenkinsBaseUrl = (req.headers['x-jenkins-url'] || '').replace(/\/$/, '');
  const username       = req.headers['x-jenkins-username'] || '';
  const token          = req.headers['x-jenkins-token']    || '';

  if (!jenkinsBaseUrl) {
    sendJSON(res, 400, { error: 'Missing X-Jenkins-URL header' });
    return;
  }

  // ── Strip /proxy prefix from path ─────────────────────
  const forwardPath = req.url.replace(/^\/proxy/, '') || '/';

  let targetUrl;
  try {
    targetUrl = new URL(forwardPath, jenkinsBaseUrl);
  } catch (e) {
    sendJSON(res, 400, { error: 'Invalid URL: ' + e.message });
    return;
  }

  // ── Build upstream request headers ────────────────────
  const upstreamHeaders = {
    'Accept': req.headers['accept'] || 'application/json, text/plain, */*'
  };

  if (req.headers['content-type']) {
    upstreamHeaders['Content-Type'] = req.headers['content-type'];
  }
  if (req.headers['content-length']) {
    upstreamHeaders['Content-Length'] = req.headers['content-length'];
  }

  // Basic auth
  if (username && token) {
    const creds = Buffer.from(`${username}:${token}`).toString('base64');
    upstreamHeaders['Authorization'] = 'Basic ' + creds;
  }

  // Jenkins CSRF crumb pass-through
  const crumbField = req.headers['x-jenkins-crumb-field'];
  const crumbValue = req.headers['x-jenkins-crumb'] || req.headers['jenkins-crumb'];
  if (crumbField && crumbValue) {
    upstreamHeaders[crumbField] = crumbValue;
  } else if (crumbValue) {
    upstreamHeaders['Jenkins-Crumb'] = crumbValue;
  }

  // ── Forward the request ───────────────────────────────
  const isHttps   = targetUrl.protocol === 'https:';
  const defaultPort = isHttps ? 443 : 80;
  const lib       = isHttps ? https : http;

  const options = {
    hostname:           targetUrl.hostname,
    port:               targetUrl.port || defaultPort,
    path:               targetUrl.pathname + targetUrl.search,
    method:             req.method,
    headers:            upstreamHeaders,
    rejectUnauthorized: false          // allow self-signed certs
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const responseHeaders = Object.assign({}, CORS_HEADERS, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream'
    });
    // Preserve Location header (for redirects after POSTs)
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
});

/* -------------------------------------------------------
   Helper
   ------------------------------------------------------- */
function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({}, CORS_HEADERS, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }));
  res.end(payload);
}

/* -------------------------------------------------------
   Start
   ------------------------------------------------------- */
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Jenkins UI Proxy Server');
  console.log('  -----------------------');
  console.log(`  Listening on  http://localhost:${PORT}`);
  console.log('');
  console.log('  Open jenkins-ui/index.html in your browser,');
  console.log('  click the Settings icon and enter your Jenkins URL,');
  console.log('  username and API token.');
  console.log('');
});
