/**
 * Jenkins UI - Connection Configuration
 * Persists Jenkins connection settings in localStorage.
 */
const JenkinsConfig = (function () {

  const KEY = 'jenkins_ui_connection';

  function get() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function save(config) {
    localStorage.setItem(KEY, JSON.stringify(config));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function isConfigured() {
    const c = get();
    return !!(c && c.url && c.username && c.token);
  }

  /**
   * Returns the base URL for API calls.
   * - Proxy mode: http://localhost:{proxyPort}/proxy
   * - Direct mode: {jenkinsUrl}  (requires Jenkins CORS plugin)
   */
  function apiBase() {
    const c = get();
    if (!c) return null;
    if (c.useProxy !== false) {
      const port = c.proxyPort || 3000;
      return `http://localhost:${port}/proxy`;
    }
    return c.url.replace(/\/$/, '');
  }

  /**
   * Extra headers that every API request must carry.
   * In proxy mode the proxy reads these to build the upstream request.
   */
  function requestHeaders() {
    const c = get();
    if (!c) return {};
    if (c.useProxy !== false) {
      // Let the proxy add Authorization
      return {
        'X-Jenkins-URL':      c.url.replace(/\/$/, ''),
        'X-Jenkins-Username': c.username,
        'X-Jenkins-Token':    c.token
      };
    }
    // Direct mode – add Authorization ourselves
    const creds = btoa(`${c.username}:${c.token}`);
    return { 'Authorization': 'Basic ' + creds };
  }

  return { get, save, clear, isConfigured, apiBase, requestHeaders };
})();
