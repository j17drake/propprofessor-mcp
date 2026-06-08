'use strict';

function createCategorizedError({ message, code = 'INTERNAL_ERROR', category = 'internal', status, cause, recovery } = {}) {
  const error = new Error(message || 'Unexpected PropProfessor MCP error');
  error.code = code;
  error.category = category;
  if (status !== undefined) error.status = status;
  if (cause !== undefined) error.cause = cause;
  if (recovery !== undefined) error.recovery = recovery;
  return error;
}

function recoveryForCode(code, category) {
  switch (code) {
    case 'AUTH_EXPIRED':
      return 'Run: pp-query login';
    case 'AUTH_REQUIRED':
      return 'Run: pp-query login';
    case 'RATE_LIMITED':
      return 'Wait 60 seconds and retry';
    case 'BACKEND_DOWN':
      return 'Try again in a few minutes';
    case 'BACKEND_ERROR':
      return 'Check PropProfessor status or try again later';
    case 'TRANSPORT_ERROR':
      return 'Check MCP transport configuration';
    case 'VALIDATION_ERROR':
      return 'Check the tool arguments and try again';
    case 'INTERNAL_ERROR':
    default:
      return 'Check logs or file an issue at github.com/j17drake/propprofessor-mcp';
  }
}

function categorizeError(error) {
  if (error && error.category && error.code) {
    if (!error.recovery) {
      error.recovery = recoveryForCode(error.code, error.category);
    }
    return error;
  }

  const message = String(error?.message || error || 'Unexpected PropProfessor MCP error');
  const lower = message.toLowerCase();

  if (error?.status === 401 || lower.includes('unauthorized')) {
    return createCategorizedError({
      message,
      code: error?.code || 'AUTH_EXPIRED',
      category: 'auth',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Run: pp-query login'
    });
  }
  if (lower.includes('auth') || lower.includes('token')) {
    return createCategorizedError({
      message,
      code: error?.code || 'AUTH_REQUIRED',
      category: 'auth',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Run: pp-query login'
    });
  }
  if (error?.status === 429 || lower.includes('rate limit')) {
    return createCategorizedError({
      message,
      code: error?.code || 'RATE_LIMITED',
      category: 'transport',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Wait 60 seconds and retry'
    });
  }
  if (
    lower.includes('content-length') ||
    lower.includes('ndjson') ||
    lower.includes('transport') ||
    lower.includes('frame')
  ) {
    return createCategorizedError({
      message,
      code: error?.code || 'TRANSPORT_ERROR',
      category: 'transport',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Check MCP transport configuration'
    });
  }
  if (error?.status === 503 || lower.includes('service unavailable')) {
    return createCategorizedError({
      message,
      code: error?.code || 'BACKEND_DOWN',
      category: 'backend',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Try again in a few minutes'
    });
  }
  if (error?.status >= 500 || lower.includes('backend')) {
    return createCategorizedError({
      message,
      code: error?.code || 'BACKEND_ERROR',
      category: 'backend',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Check PropProfessor status or try again later'
    });
  }
  if (lower.includes('required') || lower.includes('invalid') || lower.includes('unknown tool')) {
    return createCategorizedError({
      message,
      code: error?.code || 'VALIDATION_ERROR',
      category: 'validation',
      status: error?.status,
      cause: error,
      recovery: error?.recovery || 'Check the tool arguments and try again'
    });
  }
  return createCategorizedError({
    message,
    code: error?.code || 'INTERNAL_ERROR',
    category: 'internal',
    status: error?.status,
    cause: error,
    recovery: error?.recovery || 'Check logs or file an issue at github.com/j17drake/propprofessor-mcp'
  });
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

function createStdioMessageReader(
  onMessage,
  {
    allowNewlineJson = process.env.PROPPROFESSOR_MCP_NDJSON === 'true' ||
      process.env.PROPPROFESSOR_MCP_DEBUG_NDJSON === 'true'
  } = {}
) {
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
          if (line) {
            try {
              onMessage(JSON.parse(line));
            } catch {
              process.stderr.write(`[propprofessor-mcp] Skipping malformed NDJSON line: ${line.slice(0, 200)}\n`);
            }
          }
          continue;
        }
        return;
      }

      const headerText = buffer.slice(0, headerEnd);
      const contentLengthLine = headerText.split('\r\n').find((line) => /^content-length\s*:/i.test(line));
      if (!contentLengthLine) {
        buffer = buffer.slice(headerEnd + separator.length);
        process.stderr.write('[propprofessor-mcp] Skipping frame with missing Content-Length header\n');
        continue;
      }
      const contentLength = Number(contentLengthLine.split(':').slice(1).join(':').trim());
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        buffer = buffer.slice(headerEnd + separator.length);
        process.stderr.write(
          `[propprofessor-mcp] Skipping frame with invalid Content-Length header: ${contentLengthLine}\n`
        );
        continue;
      }

      const bodyStart = headerEnd + separator.length;
      const bodyEnd = bodyStart + contentLength;
      if (buffer.length < bodyEnd) return;

      const body = buffer.slice(bodyStart, bodyEnd);
      buffer = buffer.slice(bodyEnd);
      try {
        onMessage(JSON.parse(body));
      } catch {
        process.stderr.write(`[propprofessor-mcp] Skipping frame with malformed JSON body: ${body.slice(0, 200)}\n`);
      }
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
