'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..');
const expectedDefaultAuthFile = path.join(repoRoot, 'auth.json');

describe('propprofessor API auth file resolution', () => {
  it('defaults auth.json to the repository root, independent of process cwd', () => {
    const script = `const { DEFAULT_AUTH_FILE } = require(${JSON.stringify(path.join(repoRoot, 'lib', 'propprofessor-api'))}); console.log(DEFAULT_AUTH_FILE);`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: { ...process.env, AUTH_FILE: '' }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expectedDefaultAuthFile);
  });

  it('honors AUTH_FILE when explicitly provided', () => {
    const customAuthFile = path.join('/tmp', 'custom-pp-auth.json');
    const script = `const { DEFAULT_AUTH_FILE } = require(${JSON.stringify(path.join(repoRoot, 'lib', 'propprofessor-api'))}); console.log(DEFAULT_AUTH_FILE);`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: { ...process.env, AUTH_FILE: customAuthFile }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), customAuthFile);
  });
});
