'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fetchAccessToken, fetchAccessTokenViaCDP } = require('../lib/propprofessor-auth');

let tmpDir;
let authFile;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cdp-test-'));
  authFile = path.join(tmpDir, 'auth.json');
  fs.writeFileSync(
    authFile,
    JSON.stringify({
      cookies: [{ domain: '.propprofessor.com', name: '__Secure-next-auth.session-token', value: 'session-value' }],
      origins: []
    }),
    'utf8'
  );
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Shared stub WebSocket factory. Captures sent messages and feeds back
// pre-canned responses in order. Fires 'open' on next tick.
function makeStubWebSocket(responses) {
  const sent = [];
  const listeners = {};
  let onMessageCb = null;
  let responseIdx = 0;

  function StubWebSocket(url) {
    this.url = url;
    this.sent = sent;
    setImmediate(() => {
      (listeners.open || []).forEach((cb) => cb({}));
    });
    this.addEventListener = function (event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
      if (event === 'message') onMessageCb = cb;
    };
    this.removeEventListener = function (event, cb) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((x) => x !== cb);
      if (event === 'message' && onMessageCb === cb) onMessageCb = null;
    };
    this.send = function (raw) {
      sent.push(JSON.parse(raw));
      const r = responses[responseIdx++];
      if (r && onMessageCb) onMessageCb({ data: JSON.stringify(r) });
    };
    this.close = function () {};
  }
  StubWebSocket._listeners = listeners;
  return { StubWebSocket, sent, listeners };
}

// ===== fetchAccessTokenViaCDP (the new function in isolation) =====

describe('fetchAccessTokenViaCDP', () => {
  it('throws when no WebSocket implementation is available', async () => {
    // globalThis.WebSocket exists in Node 22+, so to test the "no WS" path
    // we monkey-patch it. Restore after.
    const original = globalThis.WebSocket;
    try {
      globalThis.WebSocket = undefined;
      await assert.rejects(
        fetchAccessTokenViaCDP({
          fetchImpl: async () => ({}),
          WebSocketImpl: undefined
        }),
        /WebSocket implementation/
      );
    } finally {
      globalThis.WebSocket = original;
    }
  });

  it('throws when no fetch implementation is available', async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = undefined;
      await assert.rejects(
        fetchAccessTokenViaCDP({
          fetchImpl: undefined,
          WebSocketImpl: function () {}
        }),
        /fetch implementation/
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws when the version endpoint returns non-OK', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(
      fetchAccessTokenViaCDP({ fetchImpl, WebSocketImpl: function () {} }),
      /CDP version endpoint returned 503/
    );
  });

  it('throws when version response is missing webSocketDebuggerUrl', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ Browser: 'Chrome' })
    });
    await assert.rejects(
      fetchAccessTokenViaCDP({
        fetchImpl,
        WebSocketImpl: function () {}
      }),
      /missing webSocketDebuggerUrl/
    );
  });

  it('JSON-escapes the access-token URL in the Runtime.evaluate expression', async () => {
    // Regression test for the unsafe `${ACCESS_TOKEN_URL}` template
    // interpolation in the Runtime.evaluate expression. The current constant
    // is a hardcoded HTTPS URL with no special characters, but the pattern
    // is fragile — any future change to ACCESS_TOKEN_URL (or a maintainer
    // who adds a second interpolated value) would silently re-introduce a
    // CDP-eval injection. The fix wraps the URL in JSON.stringify before
    // inlining, so we assert the produced expression contains the JSON
    // string literal form (with quotes) rather than the raw URL.
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' })
    });
    const responses = [
      { id: 1, result: { targetInfos: [{ type: 'page', url: 'https://app.propprofessor.com/', targetId: 'T1' }] } },
      { id: 2, result: { sessionId: 'S' } },
      { id: 3, result: { result: { value: JSON.stringify({ token: 't', exp: 1, perm: {} }) } } }
    ];
    const { StubWebSocket, sent } = makeStubWebSocket(responses);
    await fetchAccessTokenViaCDP({ fetchImpl, WebSocketImpl: StubWebSocket });
    const evalCall = sent.find((m) => m.method === 'Runtime.evaluate');
    const expr = evalCall.params.expression;
    // The URL must appear as a JSON-stringified literal (with surrounding
    // double quotes), NOT as a bare concatenation that could be hijacked.
    assert.ok(
      expr.includes('"https://app.propprofessor.com/api/access-token"'),
      `Runtime.evaluate expression should JSON-escape the URL; got: ${expr}`
    );
    assert.ok(
      !expr.includes("'https://app.propprofessor.com/api/access-token'"),
      `Runtime.evaluate expression should not use the old single-quoted interpolation; got: ${expr}`
    );
  });

  it('happy path: version -> ws -> fetch -> returns token', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc'
      })
    });
    const responses = [
      // Target.getTargets
      { id: 1, result: { targetInfos: [] } },
      // Target.createTarget
      { id: 2, result: { targetId: 'TARGET_1' } },
      // Target.attachToTarget
      { id: 3, result: { sessionId: 'SESS_1' } },
      // Runtime.evaluate (returns the access token)
      {
        id: 4,
        result: { result: { value: JSON.stringify({ token: 'cdp-jwt', exp: 9999, perm: { sportsbook: true } }) } }
      }
    ];
    const { StubWebSocket, sent } = makeStubWebSocket(responses);

    const result = await fetchAccessTokenViaCDP({
      fetchImpl,
      WebSocketImpl: StubWebSocket,
      cdpTimeoutMs: 1000,
      runtimeTimeoutMs: 1000
    });

    assert.equal(result.token, 'cdp-jwt');
    assert.equal(result.exp, 9999);
    assert.deepEqual(result.perm, { sportsbook: true });
    assert.equal(sent[0].method, 'Target.getTargets');
    assert.equal(sent[1].method, 'Target.createTarget');
    assert.equal(sent[2].method, 'Target.attachToTarget');
    assert.equal(sent[3].method, 'Runtime.evaluate');
    assert.equal(sent[3].sessionId, 'SESS_1');
  });

  it('reuses an existing app.propprofessor.com tab instead of creating one', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' })
    });
    const responses = [
      // Target.getTargets returns an existing tab
      {
        id: 1,
        result: { targetInfos: [{ type: 'page', url: 'https://app.propprofessor.com/screen', targetId: 'EXISTING_1' }] }
      },
      // Target.attachToTarget
      { id: 2, result: { sessionId: 'SESS_X' } },
      // Runtime.evaluate
      { id: 3, result: { result: { value: JSON.stringify({ token: 't', exp: 1, perm: {} }) } } }
    ];
    const { StubWebSocket, sent } = makeStubWebSocket(responses);

    await fetchAccessTokenViaCDP({ fetchImpl, WebSocketImpl: StubWebSocket });
    const sentMethods = sent.map((m) => m.method);
    assert.ok(
      !sentMethods.includes('Target.createTarget'),
      'should not have called Target.createTarget when an existing tab is present'
    );
    assert.ok(sentMethods.includes('Target.attachToTarget'));
  });

  it('throws when the in-page fetch returns an error object', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' })
    });
    const responses = [
      { id: 1, result: { targetInfos: [{ type: 'page', url: 'https://app.propprofessor.com/', targetId: 'T1' }] } },
      { id: 2, result: { sessionId: 'S' } },
      { id: 3, result: { result: { value: JSON.stringify({ error: 'browser fetch failed' }) } } }
    ];
    const { StubWebSocket } = makeStubWebSocket(responses);

    await assert.rejects(fetchAccessTokenViaCDP({ fetchImpl, WebSocketImpl: StubWebSocket }), /browser fetch failed/);
  });

  it('throws when the in-page fetch returns no token field', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' })
    });
    const responses = [
      { id: 1, result: { targetInfos: [{ type: 'page', url: 'https://app.propprofessor.com/', targetId: 'T1' }] } },
      { id: 2, result: { sessionId: 'S' } },
      { id: 3, result: { result: { value: JSON.stringify({ unexpected: 'shape' }) } } }
    ];
    const { StubWebSocket } = makeStubWebSocket(responses);

    await assert.rejects(fetchAccessTokenViaCDP({ fetchImpl, WebSocketImpl: StubWebSocket }), /no token/);
  });
});

// ===== fetchAccessToken fallback behavior =====

describe('fetchAccessToken — Vercel 429 self-heal via CDP fallback', () => {
  it('falls back to CDP when got-scraping returns 429', async () => {
    const cdpImpl = async () => ({
      token: 'cdp-jwt',
      exp: Math.floor(Date.now() / 1000) + 600,
      perm: { sportsbook: true }
    });
    const result = await fetchAccessToken({
      authFile,
      gotScrapingImpl: async () => ({
        statusCode: 429,
        body: '<html>Vercel security checkpoint</html>'
      }),
      cdpImpl
    });
    assert.equal(result.token, 'cdp-jwt');
  });

  it('falls back to CDP when got-scraping returns 401', async () => {
    const cdpImpl = async () => ({ token: 'cdp-jwt', exp: 9999, perm: {} });
    const result = await fetchAccessToken({
      authFile,
      gotScrapingImpl: async () => ({ statusCode: 401, body: '{"error":"Unauthorized"}' }),
      cdpImpl
    });
    assert.equal(result.token, 'cdp-jwt');
  });

  it('falls back to CDP when got-scraping throws a network error', async () => {
    const cdpImpl = async () => ({ token: 'cdp-jwt', exp: 9999, perm: {} });
    const result = await fetchAccessToken({
      authFile,
      gotScrapingImpl: async () => {
        throw new Error('ECONNRESET');
      },
      cdpImpl
    });
    assert.equal(result.token, 'cdp-jwt');
  });

  it('does NOT call CDP when got-scraping returns 500 (non-retryable, non-Vercel)', async () => {
    let cdpCalled = false;
    const cdpImpl = async () => {
      cdpCalled = true;
      return { token: 'should-not-be-used', exp: 1, perm: {} };
    };
    await assert.rejects(
      fetchAccessToken({
        authFile,
        gotScrapingImpl: async () => ({
          statusCode: 500,
          body: '{"error":"internal server error"}'
        }),
        cdpImpl
      }),
      /Failed to fetch PropProfessor access token/
    );
    assert.equal(cdpCalled, false, 'CDP should not be called for non-429/non-401 failures');
  });

  it('does NOT call CDP when got-scraping succeeds', async () => {
    let cdpCalled = false;
    const cdpImpl = async () => {
      cdpCalled = true;
      return { token: 'should-not-be-used', exp: 1, perm: {} };
    };
    const result = await fetchAccessToken({
      authFile,
      gotScrapingImpl: async () => ({
        statusCode: 200,
        body: JSON.stringify({ token: 'primary-jwt', exp: 9999, perm: { sportsbook: true } })
      }),
      cdpImpl
    });
    assert.equal(result.token, 'primary-jwt');
    assert.equal(cdpCalled, false, 'CDP should not be called when got-scraping succeeds');
  });

  it('throws combined error when BOTH got-scraping and CDP fail', async () => {
    const cdpImpl = async () => {
      throw new Error('CDP: no Chrome running');
    };
    await assert.rejects(
      fetchAccessToken({
        authFile,
        gotScrapingImpl: async () => ({ statusCode: 429, body: 'vercel wall' }),
        cdpImpl
      }),
      (err) => {
        assert.equal(err.code, 'TOKEN_REFRESH_FAILED_BOTH_PATHS');
        assert.match(err.message, /Both token refresh paths failed/);
        assert.match(err.message, /HTTP 429/);
        assert.match(err.message, /no Chrome running/);
        assert.ok(err.cause && err.cause.gotErr && err.cause.cdpErr);
        return true;
      }
    );
  });

  it('does NOT fall back to CDP when enableCdpFallback is false (got 429)', async () => {
    let cdpCalled = false;
    const cdpImpl = async () => {
      cdpCalled = true;
      return { token: 'x', exp: 1, perm: {} };
    };
    await assert.rejects(
      fetchAccessToken({
        authFile,
        gotScrapingImpl: async () => ({ statusCode: 429, body: 'vercel wall' }),
        cdpImpl,
        enableCdpFallback: false
      }),
      /HTTP 429/
    );
    assert.equal(cdpCalled, false);
  });

  it('does NOT fall back to CDP when enableCdpFallback is false (got network error)', async () => {
    let cdpCalled = false;
    const cdpImpl = async () => {
      cdpCalled = true;
      return { token: 'x', exp: 1, perm: {} };
    };
    await assert.rejects(
      fetchAccessToken({
        authFile,
        gotScrapingImpl: async () => {
          throw new Error('ECONNRESET');
        },
        cdpImpl,
        enableCdpFallback: false
      }),
      /ECONNRESET/
    );
    assert.equal(cdpCalled, false);
  });

  it('got-scraping is called exactly once before falling back to CDP', async () => {
    let gotCalls = 0;
    const cdpImpl = async () => ({ token: 'cdp-jwt', exp: 9999, perm: {} });
    const result = await fetchAccessToken({
      authFile,
      gotScrapingImpl: async () => {
        gotCalls += 1;
        return { statusCode: 429, body: 'vercel wall' };
      },
      cdpImpl
    });
    assert.equal(result.token, 'cdp-jwt');
    assert.equal(gotCalls, 1, 'got-scraping should be called exactly once before falling back');
  });
});
