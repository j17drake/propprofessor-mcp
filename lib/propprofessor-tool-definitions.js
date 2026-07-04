'use strict';

/**
 * Tool definitions have been split into domain-specific modules under lib/tool-definitions/.
 * This file re-exports from the index for backward compatibility.
 * See lib/tool-definitions/index.js, screen.js, validation.js, context.js, picks.js, meta.js.
 */
const { buildToolDefinitions, TOOL_CATEGORIES, LITE_MODE_TOOLS } = require('./tool-definitions/index');

module.exports = { buildToolDefinitions, TOOL_CATEGORIES, LITE_MODE_TOOLS };
