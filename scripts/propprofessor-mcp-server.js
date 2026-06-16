#!/usr/bin/env node
'use strict';

/**
 * PropProfessor MCP server entry point.
 *
 * In v2.0.0, the 23 createMcpHandlers() implementations were extracted to
 * ./server/handlers.js. The JSON-RPC frame (createMcpServer) and the stdio
 * serve loop stay here. createMcpHandlers is re-exported from ./server/handlers
 * for backward compatibility with existing imports.
 */

const { buildToolDefinitions } = require('../lib/propprofessor-tool-definitions');
const { createMcpHandlers, mapWithConcurrency: mapWithConcurrencyFromHandlers } = require('./server/handlers');
const {
  categorizeError,
  createJsonRpcSuccess,
  createJsonRpcError,
  encodeMessage,
  createStdioMessageReader
} = require('../lib/propprofessor-mcp-stdio');
const { redactSecrets } = require('../lib/propprofessor-redact');
const { clearTierCache } = require('../lib/propprofessor-risk-score');
const { validateArgs } = require('../lib/mcp-arg-validator');

const mapWithConcurrency = mapWithConcurrencyFromHandlers;

const SERVER_NAME = 'propprofessor';
const SERVER_VERSION = require('../package.json').version;
const PROTOCOL_VERSION = '2024-11-05';

function createMcpServer({ handlers = createMcpHandlers(), toolDefinitions = buildToolDefinitions() } = {}) {
  const toolMap = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
  let initialized = false;

  async function handleRequest(message) {
    const { id = null, method, params } = message || {};

    if (method === 'initialize') {
      initialized = true;
      return createJsonRpcSuccess(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
    }

    if (method === 'notifications/initialized') {
      return null;
    }

    if (method === 'notifications/cancelled') {
      return null;
    }

    if (method === 'ping') {
      return createJsonRpcSuccess(id, {});
    }

    if (!initialized) {
      return createJsonRpcError(id, -32002, 'Server not initialized');
    }

    if (method === 'tools/list') {
      return createJsonRpcSuccess(id, { tools: toolDefinitions });
    }

    if (method === 'tools/call') {
      // Clear tier cache at the start of each tool call so tiers are computed
      // fresh per request but stabilize within a single multi-league screen
      clearTierCache();
      const toolName = params?.name;
      const handler = handlers[toolName];
      if (!toolMap.has(toolName) || typeof handler !== 'function') {
        return createJsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
      // Enforce inputSchema at the server. The MCP client is expected to
      // validate, but the server shouldn't trust that — a misbehaving
      // client (or a hand-crafted JSON-RPC frame) can otherwise smuggle
      // unexpected fields or type-mismatched values to the handler, which
      // would either crash, silently coerce to NaN, or pass the bad value
      // to the PropProfessor backend.
      const toolDef = toolMap.get(toolName);
      const argCheck = validateArgs(toolDef.inputSchema, params?.arguments);
      if (!argCheck.ok) {
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: argCheck }, null, 2) }],
          structuredContent: { ok: false, error: argCheck },
          isError: true
        });
      }
      try {
        const result = await handler(params?.arguments || {});
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result
        });
      } catch (error) {
        const categorized = categorizeError(error);
        const debugMode = params?.arguments?.debug === true;

        // Server-side stderr logging for operators. The agent's `debug` flag
        // controls what goes back in the *response*; this is independent and
        // always-on so operators can see what's failing in their server
        // process. The redactSecrets scrub keeps real tokens/cookies out of
        // log aggregators (journald, Docker, Datadog, etc.).
        const rawStack = error.stack || error.message || String(error);
        const safeStack = redactSecrets(rawStack);
        const safeMessage = redactSecrets(categorized.message);
        process.stderr.write(
          `[propprofessor-mcp] tool=${toolName} code=${categorized.code} category=${categorized.category} message=${safeMessage}\n` +
            (safeStack ? `${safeStack}\n` : '')
        );

        const failure = {
          ok: false,
          error: {
            code: categorized.code,
            message: categorized.message,
            category: categorized.category,
            status: categorized.status,
            recovery: categorized.recovery,
            ...(debugMode
              ? {
                  stack: error.stack || null,
                  originalMessage: error.message,
                  cause: error.cause ? error.cause.message || String(error.cause) : null
                }
              : {})
          }
        };
        return createJsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(failure, null, 2) }],
          structuredContent: failure,
          isError: true
        });
      }
    }

    return createJsonRpcError(id, -32601, `Method not found: ${method}`);
  }

  return {
    async handleRequest(message) {
      return handleRequest(message);
    },
    toolDefinitions
  };
}

async function serveStdio(options = {}) {
  const server = createMcpServer(options);
  const reader = createStdioMessageReader(async (message) => {
    const response = await server.handleRequest(message);
    if (response && message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      process.stdout.write(encodeMessage(response));
    }
  });

  process.stdin.on('data', (chunk) => {
    Promise.resolve()
      .then(() => reader(chunk))
      .catch((error) => {
        process.stderr.write((error.stack || error.message || String(error)) + '\n');
      });
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  process.stdin.resume();
}

if (require.main === module) {
  serveStdio().catch((err) => {
    process.stderr.write((err.stack || err.message) + '\n');
    process.exitCode = 1;
  });
}

module.exports = {
  createMcpServer,
  createMcpHandlers,
  createStdioMessageReader,
  mapWithConcurrency,
  serveStdio,
  buildToolDefinitions
};
