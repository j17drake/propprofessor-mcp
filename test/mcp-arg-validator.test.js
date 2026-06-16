'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateArgs } = require('../lib/mcp-arg-validator');

describe('mcp-arg-validator', () => {
  describe('happy paths', () => {
    it('passes empty object on an empty schema', () => {
      const r = validateArgs({ type: 'object', properties: {}, additionalProperties: false }, {});
      assert.equal(r.ok, true);
    });

    it('passes valid args matching the schema', () => {
      const schema = {
        type: 'object',
        properties: {
          league: { type: 'string' },
          limit: { type: 'number' },
          includeAll: { type: 'boolean' }
        },
        additionalProperties: false
      };
      const r = validateArgs(schema, { league: 'NBA', limit: 5, includeAll: true });
      assert.equal(r.ok, true);
    });

    it('treats null/undefined values for optional fields as missing', () => {
      const schema = {
        type: 'object',
        properties: { debug: { type: 'boolean' } },
        additionalProperties: false
      };
      assert.equal(validateArgs(schema, { debug: null }).ok, true);
      assert.equal(validateArgs(schema, { debug: undefined }).ok, true);
    });
  });

  describe('required fields', () => {
    it('rejects when a required field is missing', () => {
      const schema = {
        type: 'object',
        properties: { leagues: { type: 'array', items: { type: 'string' } } },
        required: ['leagues'],
        additionalProperties: false
      };
      const r = validateArgs(schema, {});
      assert.equal(r.ok, false);
      assert.equal(r.code, 'VALIDATION_ERROR');
      assert.ok(r.errors.some((e) => /leagues/.test(e) && /required/.test(e)));
    });

    it('passes when a required field is present (even if null is rejected explicitly)', () => {
      const schema = {
        type: 'object',
        properties: { leagues: { type: 'array', items: { type: 'string' } } },
        required: ['leagues'],
        additionalProperties: false
      };
      const r = validateArgs(schema, { leagues: ['NBA'] });
      assert.equal(r.ok, true);
    });
  });

  describe('type mismatches', () => {
    it('rejects string for number', () => {
      const schema = {
        type: 'object',
        properties: { limit: { type: 'number' } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { limit: '5' });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /limit.*expected (finite )?number/.test(e)));
    });

    it('rejects non-integer for integer', () => {
      const schema = {
        type: 'object',
        properties: { count: { type: 'integer' } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { count: 1.5 });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /count.*expected integer/.test(e)));
    });

    it('accepts integer-valued numbers for integer', () => {
      const schema = {
        type: 'object',
        properties: { count: { type: 'integer' } },
        additionalProperties: false
      };
      assert.equal(validateArgs(schema, { count: 5 }).ok, true);
    });

    it('rejects number for boolean', () => {
      const schema = {
        type: 'object',
        properties: { debug: { type: 'boolean' } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { debug: 1 });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /debug.*expected boolean/.test(e)));
    });

    it('rejects non-array for array', () => {
      const schema = {
        type: 'object',
        properties: { leagues: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { leagues: 'NBA' });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /leagues.*expected array/.test(e)));
    });

    it('rejects array elements that violate items.type', () => {
      const schema = {
        type: 'object',
        properties: { limits: { type: 'array', items: { type: 'number' } } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { limits: [1, 'two', 3] });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /limits\[1\].*expected (finite )?number/.test(e)));
    });
  });

  describe('enum constraints', () => {
    it('rejects values not in the enum list', () => {
      const schema = {
        type: 'object',
        properties: { verbosity: { type: 'string', enum: ['minimal', 'standard', 'full'] } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { verbosity: 'verbose' });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /verbosity.*must be one of/.test(e)));
    });

    it('accepts values in the enum list', () => {
      const schema = {
        type: 'object',
        properties: { verbosity: { type: 'string', enum: ['minimal', 'standard', 'full'] } },
        additionalProperties: false
      };
      assert.equal(validateArgs(schema, { verbosity: 'standard' }).ok, true);
    });
  });

  describe('additionalProperties: false', () => {
    it('rejects unknown properties', () => {
      const schema = {
        type: 'object',
        properties: { league: { type: 'string' } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { league: 'NBA', injected: 'rm -rf /' });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /injected.*unknown property/.test(e)));
    });

    it('allows unknown properties when additionalProperties is not false', () => {
      const schema = {
        type: 'object',
        properties: { league: { type: 'string' } }
        // no additionalProperties: false
      };
      const r = validateArgs(schema, { league: 'NBA', anything: 'goes' });
      assert.equal(r.ok, true);
    });
  });

  describe('malformed input', () => {
    it('rejects null input as the args object', () => {
      const r = validateArgs(
        { type: 'object', properties: { league: { type: 'string' } }, additionalProperties: false },
        null
      );
      assert.equal(r.ok, false);
    });

    it('rejects array input as the args object', () => {
      const r = validateArgs({ type: 'object', properties: {}, additionalProperties: false }, ['not', 'an', 'object']);
      assert.equal(r.ok, false);
    });

    it('rejects non-finite numbers', () => {
      const schema = {
        type: 'object',
        properties: { limit: { type: 'number' } },
        additionalProperties: false
      };
      const r = validateArgs(schema, { limit: Number.POSITIVE_INFINITY });
      assert.equal(r.ok, false);
    });
  });

  describe('nested objects', () => {
    it('validates nested object properties', () => {
      const schema = {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            properties: {
              minOdds: { type: 'number' },
              maxOdds: { type: 'number' }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      };
      const r = validateArgs(schema, { filters: { minOdds: -120, maxOdds: '200' } });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /filters\.maxOdds.*expected (finite )?number/.test(e)));
    });
  });
});
