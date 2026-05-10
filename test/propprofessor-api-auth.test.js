'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { installAuthFile } = require('../lib/propprofessor-api');

const repoRoot = path.join(__dirname, '..');
const expectedUserAuthFile = path.join(os.homedir(), '.propprofessor', 'auth.json');
const expectedRepoAuthFile = path.join(repoRoot, 'auth.json');

describe('propprofessor API auth file resolution', () => {
  it('defaults auth.json to the user-level path when AUTH_FILE is unset', () => {
    const script = `const fs = require('fs'); const os = require('os'); const path = require('path'); const originalExistsSync = fs.existsSync; fs.existsSync = file => String(file) === path.join(os.homedir(), '.propprofessor', 'auth.json'); const { DEFAULT_AUTH_FILE } = require(${JSON.stringify(path.join(repoRoot, 'lib', 'propprofessor-api'))}); console.log(DEFAULT_AUTH_FILE); fs.existsSync = originalExistsSync;`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: { ...process.env, AUTH_FILE: '' }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expectedUserAuthFile);
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

  it('exposes the fallback auth file search order', () => {
    const script = `const { getAuthFileCandidates } = require(${JSON.stringify(path.join(repoRoot, 'lib', 'propprofessor-api'))}); console.log(JSON.stringify(getAuthFileCandidates()));`;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: { ...process.env, AUTH_FILE: '' }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), [expectedUserAuthFile, expectedRepoAuthFile]);
  });

  it('can install a saved auth file into the user-level default location', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-auth-install-'));
    const sourceFile = path.join(tempDir, 'source-auth.json');
    const destinationFile = path.join(tempDir, '.propprofessor', 'auth.json');
    fs.writeFileSync(
      sourceFile,
      JSON.stringify({ cookies: [{ domain: '.propprofessor.com', name: 'session', value: 'abc' }] }),
      'utf8'
    );

    try {
      const result = installAuthFile({ sourceFile, destinationFile });
      assert.equal(result.ok, true);
      assert.equal(result.destinationFile, destinationFile);
      assert.equal(fs.existsSync(destinationFile), true);
      assert.match(fs.readFileSync(destinationFile, 'utf8'), /session/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
