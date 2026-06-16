'use strict';

/**
 * Minimal JSON-Schema arg validator for MCP tool calls.
 *
 * The MCP server already declares inputSchema with `additionalProperties: false`
 * on every tool, but the JSON-RPC frame never enforces it — the client is
 * expected to. This module gives the server its own enforcement so that:
 *   - A misbehaving or hostile client can't smuggle unexpected fields
 *     through to handlers (or to the PropProfessor backend).
 *   - Type mismatches (string where number expected) are caught up front
 *     with a precise error message, before the handler does `Number(...)`
 *     coercions that silently produce NaN.
 *
 * Scope: we intentionally implement just the JSON-Schema subset that the
 * project actually uses in lib/propprofessor-tool-definitions.js:
 *   - type: 'object' / 'string' / 'number' / 'integer' / 'boolean' / 'array'
 *   - properties: { name: { type, enum?, items?, description? } }
 *   - required: string[]
 *   - additionalProperties: false
 *   - enum: string[]
 *   - items: { type }
 *
 * Anything outside this subset (oneOf, allOf, $ref, patternProperties, ...)
 * falls through to the existing handler-level validation, which is fine
 * because the project's schemas don't use those constructs.
 *
 * The validator never throws — it returns { ok: true } on success or
 * { ok: false, code, message, errors } on failure so the caller can wire
 * the result into the existing categorizeError() pipeline.
 */

function validateArgs(schema, args) {
  const errors = [];
  // args must be a plain object. null, undefined, arrays, strings, etc. are
  // all invalid — surface them as a top-level error rather than silently
  // coercing to {} (which would skip validation entirely).
  if (args === undefined) {
    args = {};
  } else if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `Argument validation failed: arguments must be a JSON object, got ${describeType(args)}`,
      errors: [`arguments: expected object, got ${describeType(args)}`]
    };
  }
  validateObject(args, schema, '', errors);
  if (errors.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'VALIDATION_ERROR',
    message: `Argument validation failed: ${errors.join('; ')}`,
    errors
  };
}

function validateObject(value, schema, path, errors) {
  if (schema.type !== 'object') {
    errors.push(`${path || '<arg>'}: expected schema type 'object'`);
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path || '<arg>'}: expected object, got ${describeType(value)}`);
    return;
  }

  // additionalProperties: false — flag any unknown keys up front.
  if (schema.additionalProperties === false && schema.properties) {
    const allowed = new Set(Object.keys(schema.properties));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        errors.push(`${path ? path + '.' : ''}${key}: unknown property (not in schema)`);
      }
    }
  }

  // Required fields present and non-null.
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!(key in value) || value[key] === null || value[key] === undefined) {
        errors.push(`${path ? path + '.' : ''}${key}: required`);
      }
    }
  }

  // Per-property type checks.
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value && value[key] !== undefined && value[key] !== null) {
        validateValue(value[key], propSchema, joinPath(path, key), errors);
      }
    }
  }
}

function validateValue(value, schema, path, errors) {
  // Enum wins over type — an enum mismatch is more specific.
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(
      `${path}: must be one of [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}], got ${JSON.stringify(value)}`
    );
    return;
  }

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string, got ${describeType(value)}`);
      }
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${path}: expected finite number, got ${describeType(value)}`);
      }
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer, got ${describeType(value)}`);
      }
      break;
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean, got ${describeType(value)}`);
      }
      break;
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${describeType(value)}`);
        return;
      }
      if (schema.items && typeof schema.items === 'object') {
        for (let i = 0; i < value.length; i += 1) {
          if (value[i] !== null && value[i] !== undefined) {
            validateValue(value[i], schema.items, `${path}[${i}]`, errors);
          }
        }
      }
      break;
    case 'object':
      validateObject(value, schema, path, errors);
      break;
    default:
      // Unknown / unhandled schema type — pass through; the handler does its
      // own validation. (This is intentionally permissive: we don't want to
      // regress tools that use untyped property bags like `fields: { type: 'string' }`
      // to mean "free-form string".)
      break;
  }
}

function joinPath(parent, key) {
  return parent ? `${parent}.${key}` : key;
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

module.exports = { validateArgs };
