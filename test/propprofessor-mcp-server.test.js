'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const serverPath = path.join(__dirname, '..', 'scripts', 'propprofessor-mcp-server.js');

function createJsonRpcMessage(id, method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
}

function waitForJsonRpcMessage(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MCP response. Buffer: ${buffer.slice(0, 500)}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onStderr);
      proc.off('exit', onExit);
    }

    function maybeParse() {
      const separator = '\r\n\r\n';
      const headerEnd = buffer.indexOf(separator);
      if (headerEnd === -1) return null;
      const headerText = buffer.slice(0, headerEnd);
      const headers = {};
      for (const line of headerText.split('\r\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
      }
      const contentLength = Number(headers['content-length'] || 0);
      const bodyStart = headerEnd + separator.length;
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        throw new Error(`Invalid Content-Length header: ${headers['content-length'] || '<missing>'}`);
      }
      if (buffer.length < bodyStart + contentLength) return null;
      const body = buffer.slice(bodyStart, bodyStart + contentLength);
      buffer = buffer.slice(bodyStart + contentLength);
      return JSON.parse(body);
    }

    function onData(chunk) {
      buffer += chunk.toString('utf8');
      try {
        const message = maybeParse();
        if (message) {
          cleanup();
          resolve(message);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    }

    function onStderr(chunk) {
      buffer += `\n[stderr] ${chunk.toString('utf8')}`;
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`MCP server exited early with code ${code}. Buffer: ${buffer.slice(0, 500)}`));
    }

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onStderr);
    proc.on('exit', onExit);
  });
}

describe('propprofessor MCP server stdio contract', () => {
  it('responds to initialize and lists the expected tools', async () => {
    const proc = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    try {
      proc.stdin.write(createJsonRpcMessage(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }));

      const initializeResponse = await waitForJsonRpcMessage(proc);
      assert.equal(initializeResponse.id, 1);
      assert.equal(initializeResponse.jsonrpc, '2.0');
      assert.equal(initializeResponse.result.serverInfo.name, 'propprofessor');
      assert.ok(initializeResponse.result.capabilities.tools);

      proc.stdin.write(createJsonRpcMessage(2, 'tools/list', {}));
      const toolsResponse = await waitForJsonRpcMessage(proc);
      assert.equal(toolsResponse.id, 2);
      const toolNames = toolsResponse.result.tools.map(tool => tool.name).sort();
      assert.deepEqual(toolNames, [
        'clear_hidden_bets',
        'get_hidden_bets',
        'health_status',
        'hide_ev_row',
        'hide_fantasy_row',
        'league_presets',
        'query_fantasy',
        'query_fantasy_sorted',
        'query_mlb_screen',
        'query_nba_screen',
        'query_ncaab_screen',
        'query_ncaaf_screen',
        'query_nfl_screen',
        'query_nhl_screen',
        'query_screen_odds',
        'query_screen_odds_best_comps',
        'query_screen_odds_ranked',
        'query_soccer_screen',
        'query_sport_screen',
        'query_tennis_screen',
        'query_wnba_screen',
        'unhide_bet'
      ]);
    } finally {
      proc.kill('SIGTERM');
    }
  });
});
