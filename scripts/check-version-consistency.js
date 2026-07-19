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

// Find the FIRST ## X.Y.Z heading in the changelog
const changelogLines = changelog.split('\n');
const topLineIdx = changelogLines.findIndex(l => /^##\s+\d+\.\d+\.\d+/.test(l));
if (topLineIdx === -1) {
  fail('CHANGELOG.md has no version headings');
}

const topHeading = changelogLines[topLineIdx].trim();
const expectedHeading = `## ${version}`;
if (topHeading !== expectedHeading) {
  fail(
    `CHANGELOG.md top heading is "${topHeading}" but package.json version is "${version}"`
  );
}

const githubRef = process.env.GITHUB_REF || '';
if (githubRef.startsWith('refs/tags/v')) {
  const tagVersion = githubRef.replace(/^refs\/tags\/v/, '');
  if (tagVersion !== version) {
    fail(`Tag version v${tagVersion} does not match package.json version ${version}`);
  }
}

console.log(`Version consistency check passed for ${version}`);
