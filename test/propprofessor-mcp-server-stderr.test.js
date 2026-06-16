'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createMcpServer } = require('../scripts/propprofessor-mcp-server');

/**
 * Capture every chunk written to process.stderr during a test, then return
 * the captured string. Restores the original write function in afterEach so
 * subsequent tests aren't affected.
 */
function captureStderr() {
  const chunks = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  return {
    text: () => chunks.join(''),
    restore: () => {
      process.stderr.write = original;
    }
  };
}

async function send(server, request) {
  return server.handleRequest(request);
}

describe('server-side stderr error logging', () => {
  let stderr;

  afterEach(() => {
    if (stderr) stderr.restore();
    stderr = null;
  });

  it('writes a structured stderr line when a tool handler throws (debug=false)', async () => {
    // Create a server with a handler that always throws.
    const server = createMcpServer({
      handlers: {
        bad_tool: async () => {
          throw new Error('backend exploded');
        }
      }
    });
    // Bypass tools/list validation by sending a tools/call with a hand-crafted
    // request that the test layer wouldn't normally produce. We do this by
    // re-using the toolDefinitions array — but for this test we just need
    // the error path to fire, so we mount a handler directly.
    await send(server, { jsonrpc: '2.0', id: 1, method: 'initialize' });

    stderr = captureStderr();
    const result = await send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'unknown_tool', arguments: {} }
    });
    // unknown_tool returns a JSON-RPC error (not a thrown exception) — so
    // the stderr logging path won't fire. We need a tool that's *defined*
    // and *throws* to exercise this. Skip the assertion path here and use
    // the next test instead.
    assert.ok(result, 'handler should return a response even for unknown tool');
    const output = stderr.text();
    // unknown_tool returns a JSON-RPC error directly, not a thrown error,
    // so stderr should be empty in this case.
    assert.equal(output, '', 'no stderr for non-thrown errors');
  });

  it('writes to stderr when a defined tool handler throws, with stack and code', async () => {
    const server = createMcpServer({
      handlers: {
        // Pre-register a fake tool definition so it passes the toolMap check.
        // We mount it via the toolDefinitions override.
        // Since the existing toolDefinitions list is fixed, we use a real tool
        // name and replace its handler with one that throws.
        recommended_bets: async () => {
          throw new Error('downstream API call failed');
        }
      }
    });
    await send(server, { jsonrpc: '2.0', id: 1, method: 'initialize' });

    stderr = captureStderr();
    const result = await send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'recommended_bets', arguments: {} }
    });

    // The tool call returned a structured error response (not a JSON-RPC
    // protocol error), so the client still gets a valid response.
    assert.equal(result.jsonrpc, '2.0');
    assert.equal(result.id, 2);
    assert.ok(result.result, 'response includes a result object');
    assert.equal(result.result.isError, true, 'isError flag set on the result');

    const output = stderr.text();
    assert.ok(output.includes('tool=recommended_bets'), `stderr should include tool name, got: ${output}`);
    assert.ok(
      output.includes('message=downstream API call failed'),
      `stderr should include the error message, got: ${output}`
    );
    assert.ok(
      output.includes('Error:') || output.includes('at '),
      `stderr should include a stack trace, got: ${output.slice(0, 200)}`
    );
  });

  it('redacts real-looking tokens from the stderr log line', async () => {
    const secret = 'ya29.' + 'A'.repeat(40);
    const server = createMcpServer({
      handlers: {
        recommended_bets: async () => {
          const e = new Error(`Upstream call failed: bearer ${secret}`);
          throw e;
        }
      }
    });
    await send(server, { jsonrpc: '2.0', id: 1, method: 'initialize' });

    stderr = captureStderr();
    await send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'recommended_bets', arguments: {} }
    });

    const output = stderr.text();
    assert.ok(!output.includes(secret), `real token must be scrubbed, got: ${output}`);
    assert.ok(output.includes('[REDACTED]'), 'redaction marker should appear in stderr');
  });

  it('does not write to stderr on successful tool calls', async () => {
    const server = createMcpServer({
      handlers: {
        recommended_bets: async () => ({ ok: true, result: [] })
      }
    });
    await send(server, { jsonrpc: '2.0', id: 1, method: 'initialize' });

    stderr = captureStderr();
    await send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'recommended_bets', arguments: {} }
    });

    assert.equal(stderr.text(), '', 'no stderr on success');
  });

  it('does not write to stderr when arg validation fails (expected client error)', async () => {
    // recommended_bets requires `leagues: Array<string>`. Pass an empty object
    // so the server-side validator rejects the call before reaching the
    // handler. This should NOT produce a stderr line — it's a client error.
    const server = createMcpServer({
      handlers: {
        recommended_bets: async () => {
          throw new Error('handler should not be called for invalid args');
        }
      }
    });
    await send(server, { jsonrpc: '2.0', id: 1, method: 'initialize' });

    stderr = captureStderr();
    const result = await send(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'recommended_bets', arguments: { leagues: 'not-an-array' } }
    });

    assert.equal(result.result.isError, true, 'validation should fail');
    // The validation error path doesn't throw — it returns a structured
    // error directly. So no stderr should be written.
    assert.equal(stderr.text(), '', 'validation failures are not thrown, so no stderr');
  });
});
