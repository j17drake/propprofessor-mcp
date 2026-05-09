#!/usr/bin/env node
'use strict';

const { main } = require('../lib/propprofessor-sharp-plays-dashboard');

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
