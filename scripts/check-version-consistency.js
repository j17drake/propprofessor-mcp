#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, 'package.json');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const changelog = fs.readFileSync(changelogPath, 'utf8');

const version = packageJson.version;
const changelogHeading = new RegExp(`^##\\s+${version.replace(/\./g, '\\.')}$`, 'm');

if (!changelogHeading.test(changelog)) {
  fail(`CHANGELOG.md is missing a heading for package version ${version}`);
}

const githubRef = process.env.GITHUB_REF || '';
if (githubRef.startsWith('refs/tags/v')) {
  const tagVersion = githubRef.replace(/^refs\/tags\/v/, '');
  if (tagVersion !== version) {
    fail(`Tag version v${tagVersion} does not match package.json version ${version}`);
  }
}

console.log(`Version consistency check passed for ${version}`);
