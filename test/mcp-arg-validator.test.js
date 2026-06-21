'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateArgs, normalizeArgs } = require('../lib/mcp-arg-validator');

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

  describe('__requiredAliases (deprecated aliases satisfy required-check)', () => {
    const schema = {
      type: 'object',
      properties: {
        league: { type: 'string' },
        gameIds: { type: 'array', items: { type: 'string' } },
        game_ids: { type: 'array', items: { type: 'string' } }
      },
      required: ['league', 'gameIds'],
      __requiredAliases: { gameIds: ['game_ids'] },
      additionalProperties: false
    };

    it('accepts canonical name in args', () => {
      const r = validateArgs(schema, { league: 'NBA', gameIds: ['x'] });
      assert.equal(r.ok, true);
    });

    it('accepts deprecated alias in args (back-compat)', () => {
      const r = validateArgs(schema, { league: 'NBA', game_ids: ['x'] });
      assert.equal(r.ok, true);
    });

    it('rejects when neither canonical nor alias is present', () => {
      const r = validateArgs(schema, { league: 'NBA' });
      assert.equal(r.ok, false);
      assert.ok(r.errors.some((e) => /gameIds: required/.test(e)));
    });

    it('prefers canonical value when both are present (no overwrite)', () => {
      // Canonical wins — alias is ignored if both are supplied.
      const r = validateArgs(schema, { league: 'NBA', gameIds: ['canonical'], game_ids: ['alias'] });
      assert.equal(r.ok, true);
    });

    it('does not mutate caller args (shallow copy on required-alias path)', () => {
      const callerArgs = { league: 'NBA', game_ids: ['x'] };
      const snapshot = JSON.parse(JSON.stringify(callerArgs));
      validateArgs(schema, callerArgs);
      assert.deepStrictEqual(callerArgs, snapshot);
    });

    it('schemas without __requiredAliases behave as before', () => {
      const plainSchema = {
        type: 'object',
        properties: { league: { type: 'string' } },
        required: ['league'],
        additionalProperties: false
      };
      assert.equal(validateArgs(plainSchema, { league: 'NBA' }).ok, true);
      assert.equal(validateArgs(plainSchema, {}).ok, false);
    });
  });

  describe('normalizeArgs (canonical <-> alias sync at dispatch)', () => {
    it('returns a NEW object, does not mutate input', () => {
      const input = { is_live: true };
      const out = normalizeArgs('any_tool', input);
      assert.notStrictEqual(out, input);
      assert.deepStrictEqual(input, { is_live: true });
    });

    it('passes through null/undefined args unchanged', () => {
      assert.equal(normalizeArgs('any_tool', null), null);
      assert.equal(normalizeArgs('any_tool', undefined), undefined);
    });

    it('live <-> is_live: copies live -> is_live when is_live is missing', () => {
      const out = normalizeArgs('any_tool', { live: true });
      assert.deepStrictEqual(out, { live: true, is_live: true });
    });

    it('live <-> is_live: copies is_live -> live when live is missing', () => {
      const out = normalizeArgs('any_tool', { is_live: true });
      assert.deepStrictEqual(out, { live: true, is_live: true });
    });

    it('live <-> is_live: when BOTH present, preserves caller values (no overwrite)', () => {
      const out = normalizeArgs('any_tool', { live: true, is_live: false });
      assert.deepStrictEqual(out, { live: true, is_live: false });
    });

    it('get_play_details: gameIds <-> game_ids sync', () => {
      const out1 = normalizeArgs('get_play_details', { league: 'NBA', gameIds: ['a', 'b'] });
      assert.deepStrictEqual(out1, { league: 'NBA', gameIds: ['a', 'b'], game_ids: ['a', 'b'] });

      const out2 = normalizeArgs('get_play_details', { league: 'NBA', game_ids: ['a', 'b'] });
      assert.deepStrictEqual(out2, { league: 'NBA', gameIds: ['a', 'b'], game_ids: ['a', 'b'] });
    });

    it('get_play_details: does not sync gameId (validate_play param) — wrong tool name', () => {
      // validate_play uses singular `gameId`, not `gameIds`. normalizeArgs
      // for the WRONG tool name should not touch gameId at all.
      const out = normalizeArgs('validate_play', { gameId: 'abc' });
      assert.deepStrictEqual(out, { gameId: 'abc' });
    });

    it('preserves unknown keys (does not strip them)', () => {
      // Validator strips unknown keys via additionalProperties:false, but
      // normalizeArgs runs separately and shouldn't lose data.
      const out = normalizeArgs('any_tool', { is_live: true, weirdExtra: 'ok' });
      assert.equal(out.weirdExtra, 'ok');
    });
  });
});
