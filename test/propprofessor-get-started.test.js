'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildToolDefinitions } = require('../lib/propprofessor-tool-definitions');
const { createMcpHandlers } = require('../scripts/propprofessor-mcp-server');

describe('get_started tool definition', () => {
  const definitions = buildToolDefinitions();
  const tool = definitions.find((t) => t.name === 'get_started');

  it('exists in tool definitions', () => {
    assert.ok(tool, 'get_started tool should exist in definitions');
  });

  it('description mentions workflow', () => {
    assert.ok(tool.description.toLowerCase().includes('workflow'), 'description should mention workflow');
  });

  it('user_type param has correct enum values', () => {
    const userType = tool.inputSchema.properties.user_type;
    assert.ok(userType, 'user_type property should exist');
    assert.deepEqual(userType.enum, ['casual', 'intermediate', 'sharp']);
  });

  it('user_type is required', () => {
    assert.ok(tool.inputSchema.required.includes('user_type'), 'user_type should be required');
  });

  it('has additionalProperties set to false', () => {
    assert.equal(tool.inputSchema.additionalProperties, false);
  });
});

describe('get_started handler', () => {
  const handlers = createMcpHandlers();

  it('returns workflow for casual user type', async () => {
    const result = await handlers.get_started({ user_type: 'casual' });
    assert.ok(result.summary);
    assert.ok(Array.isArray(result.steps));
    assert.ok(result.steps.length > 0);
    assert.ok(Array.isArray(result.tools_to_use));
    assert.ok(result.tools_to_use.includes('quick_screen'));
    assert.ok(Array.isArray(result.avoid));
    assert.ok(result.avoid.includes('sharp_consensus'));
    assert.ok(result.avoid.includes('sharp_consensus'));
  });

  it('returns workflow for sharp user type', async () => {
    const result = await handlers.get_started({ user_type: 'sharp' });
    assert.ok(result.summary);
    assert.ok(Array.isArray(result.steps));
    assert.ok(result.tools_to_use.includes('quick_screen'));
    assert.ok(result.tools_to_use.includes('sharp_consensus'));
    assert.ok(result.tools_to_use.includes('sharp_plays'));
    assert.ok(result.tools_to_use.includes('staking_plan'));
    assert.deepEqual(result.avoid, []);
  });

  it('defaults to intermediate when user_type is missing', async () => {
    const result = await handlers.get_started({});
    assert.ok(result.summary.includes('edge and tier'));
  });

  it('falls back to intermediate for unknown user type', async () => {
    const result = await handlers.get_started({ user_type: 'unknown' });
    assert.ok(result.summary.includes('edge and tier'));
  });

  it('each workflow has all required fields', async () => {
    for (const userType of ['casual', 'intermediate', 'sharp']) {
      const result = await handlers.get_started({ user_type: userType });
      assert.ok(typeof result.summary === 'string', `${userType} should have summary string`);
      assert.ok(Array.isArray(result.steps), `${userType} should have steps array`);
      assert.ok(result.steps.length >= 2, `${userType} should have at least 2 steps`);
      assert.ok(Array.isArray(result.tools_to_use), `${userType} should have tools_to_use array`);
      assert.ok(result.tools_to_use.length >= 1, `${userType} should recommend at least 1 tool`);
      assert.ok(Array.isArray(result.avoid), `${userType} should have avoid array`);
    }
  });
});
