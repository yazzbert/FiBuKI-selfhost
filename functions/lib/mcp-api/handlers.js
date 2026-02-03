"use strict";
/**
 * MCP API Handlers
 *
 * Re-exports from the central tool registry.
 * This file exists for backwards compatibility.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_NAMES = exports.handleToolInternal = void 0;
var handlers_1 = require("../tools/handlers");
Object.defineProperty(exports, "handleToolInternal", { enumerable: true, get: function () { return handlers_1.handleTool; } });
Object.defineProperty(exports, "TOOL_NAMES", { enumerable: true, get: function () { return handlers_1.TOOL_NAMES; } });
//# sourceMappingURL=handlers.js.map