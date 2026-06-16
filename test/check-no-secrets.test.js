'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  checkWorkingTree,
  checkTrackedFiles,
  FORBIDDEN_PATHS,
  FORBIDDEN_PATTERNS
} = require('../scripts/check-no-secrets');

describe('check-no-secrets', () => {
  describe('exports', () => {
    it('exports the canonical forbidden paths', () => {
      assert.ok(Array.isArray(FORBIDDEN_PATHS));
      assert.ok(FORBIDDEN_PATHS.includes('auth.json'));
      assert.ok(FORBIDDEN_PATHS.includes('token-cache.json'));
      assert.ok(FORBIDDEN_PATHS.includes('.propprofessor'));
    });

    it('exports patterns that match nested files under .propprofessor/', () => {
      const pattern = FORBIDDEN_PATTERNS.find((re) => re.source.startsWith('^\\.propprofessor'));
      assert.ok(pattern, 'expected a pattern for .propprofessor/');
      assert.ok(pattern.test('.propprofessor/auth.json'));
      assert.ok(pattern.test('.propprofessor/token-cache.json'));
      assert.ok(pattern.test('.propprofessor/sub/deep.json'));
      assert.ok(!pattern.test('propprofessor.json'), 'unrelated names must not match');
    });
  });

  describe('checkWorkingTree', () => {
    let tmpDir;
    before(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-secrets-test-'));
    });
    after(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns an empty array when no forbidden files are present', () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = checkWorkingTree();
        assert.deepEqual(result, []);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('flags auth.json when it exists in the working tree', () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        fs.writeFileSync(path.join(tmpDir, 'auth.json'), '{}');
        const result = checkWorkingTree();
        assert.ok(result.includes('auth.json'), `expected auth.json in ${JSON.stringify(result)}`);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('flags .propprofessor/ directory when it exists', () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        fs.mkdirSync(path.join(tmpDir, '.propprofessor'), { recursive: true });
        const result = checkWorkingTree();
        assert.ok(result.includes('.propprofessor'), `expected .propprofessor in ${JSON.stringify(result)}`);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('checkTrackedFiles', () => {
    it('returns an empty array when the repo has no tracked credentials', () => {
      // This test runs from the propprofessor-mcp repo root, which has no
      // tracked credentials by design (the audit verified this on 2026-06-16).
      const result = checkTrackedFiles();
      assert.deepEqual(result, [], `repo should have no tracked credentials, but found: ${result.join(', ')}`);
    });
  });
});
