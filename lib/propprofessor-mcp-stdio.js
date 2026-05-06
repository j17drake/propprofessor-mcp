'use strict';

function createCategorizedError({ message, code = 'INTERNAL_ERROR', category = 'internal', status, cause } = {}) {
  const error = new Error(message || 'Unexpected PropProfessor MCP error');
  error.code = code;
  error.category = category;
  if (status !== undefined) error.status = status;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function categorizeError(error) {
  if (error && error.category && error.code) {
    return error;
  }

  const message = String(error?.message || error || 'Unexpected PropProfessor MCP error');
  const lower = message.toLowerCase();

  if (error?.status === 401 || lower.includes('auth') || lower.includes('unauthorized') || lower.includes('token')) {
    return createCategorizedError({ message, code: error?.code || 'AUTH_REQUIRED', category: 'auth', status: error?.status, cause: error });
  }
  if (error?.status === 429 || lower.includes('content-length') || lower.includes('ndjson') || lower.includes('transport') || lower.includes('frame')) {
    return createCategorizedError({ message, code: error?.code || 'TRANSPORT_ERROR', category: 'transport', status: error?.status, cause: error });
  }
  if (error?.status >= 500 || lower.includes('backend') || lower.includes('service unavailable')) {
    return createCategorizedError({ message, code: error?.code || 'BACKEND_ERROR', category: 'backend', status: error?.status, cause: error });
  }
  if (lower.includes('required') || lower.includes('invalid') || lower.includes('unknown tool')) {
    return createCategorizedError({ message, code: error?.code || 'VALIDATION_ERROR', category: 'validation', status: error?.status, cause: error });
  }
  return createCategorizedError({ message, code: error?.code || 'INTERNAL_ERROR', category: 'internal', status: error?.status, cause: error });
}

function createJsonRpcSuccess(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function createJsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function encodeMessage(payload, { newlineJson = process.env.PROPPROFESSOR_MCP_NDJSON === 'true' } = {}) {
  const body = JSON.stringify(payload);
  if (newlineJson) {
    return `${body}\n`;
  }
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function createStdioMessageReader(onMessage, { allowNewlineJson = process.env.PROPPROFESSOR_MCP_NDJSON === 'true' || process.env.PROPPROFESSOR_MCP_DEBUG_NDJSON === 'true' } = {}) {
  let buffer = '';

  return function onData(chunk) {
    buffer += chunk.toString('utf8');

    while (buffer.length > 0) {
      const separator = '\r\n\r\n';
      const headerEnd = buffer.indexOf(separator);

      if (headerEnd === -1) {
        if (allowNewlineJson) {
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx === -1) return;
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (line) onMessage(JSON.parse(line));
          continue;
        }
        return;
      }

      const headerText = buffer.slice(0, headerEnd);
      const contentLengthLine = headerText
        .split('\r\n')
        .find(line => /^content-length\s*:/i.test(line));
      if (!contentLengthLine) {
        throw createCategorizedError({
          message: 'Missing Content-Length header',
          code: 'INVALID_MCP_FRAME',
          category: 'transport'
        });
      }
      const contentLength = Number(contentLengthLine.split(':').slice(1).join(':').trim());
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        throw createCategorizedError({
          message: `Invalid Content-Length header: ${contentLengthLine}`,
          code: 'INVALID_MCP_FRAME',
          category: 'transport'
        });
      }

      const bodyStart = headerEnd + separator.length;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) return;

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);
      onMessage(JSON.parse(body));
    }
  };
}

module.exports = {
  createCategorizedError,
  categorizeError,
  createJsonRpcSuccess,
  createJsonRpcError,
  encodeMessage,
  createStdioMessageReader
};
