/**
 * FiBuKI OpenClaw Plugin
 *
 * Exposes FiBuKI MCP tools as OpenClaw agent tools for managing
 * bank transactions, receipts, files, and tax categorization.
 */

import { createContext } from "@taxstudio/mcp-server/src/context.js";
import {
  sourceToolDefinitions,
  registerSourceTools,
} from "@taxstudio/mcp-server/src/tools/sources.js";
import {
  transactionToolDefinitions,
  registerTransactionTools,
} from "@taxstudio/mcp-server/src/tools/transactions.js";
import {
  fileToolDefinitions,
  registerFileTools,
} from "@taxstudio/mcp-server/src/tools/files.js";
import {
  categoryToolDefinitions,
  registerCategoryTools,
} from "@taxstudio/mcp-server/src/tools/categories.js";
import {
  automationToolDefinitions,
  registerAutomationTools,
} from "@taxstudio/mcp-server/src/tools/automations.js";
import {
  emailInboundToolDefinitions,
  registerEmailInboundTools,
} from "@taxstudio/mcp-server/src/tools/email-inbound.js";

import type { OperationsContext } from "@taxstudio/mcp-server/src/types.js";

// OpenClaw plugin API types (simplified)
interface OpenClawApi {
  config: PluginConfig;
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  registerAgentTool: (tool: AgentTool) => void;
  registerService: (service: Service) => void;
}

interface PluginConfig {
  userId?: string;
  useEmulators?: boolean;
}

interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

interface Service {
  id: string;
  start: () => void;
  stop: () => void;
}

// All tool modules to register
const toolModules = [
  { definitions: sourceToolDefinitions, handler: registerSourceTools },
  { definitions: transactionToolDefinitions, handler: registerTransactionTools },
  { definitions: fileToolDefinitions, handler: registerFileTools },
  { definitions: categoryToolDefinitions, handler: registerCategoryTools },
  { definitions: automationToolDefinitions, handler: registerAutomationTools },
  { definitions: emailInboundToolDefinitions, handler: registerEmailInboundTools },
];

/**
 * Convert MCP tool result to OpenClaw string response
 */
function formatResult(
  result: { content: Array<{ type: string; text: string }>; isError?: boolean } | null
): string {
  if (!result) {
    return "Tool returned no result";
  }
  if (result.isError) {
    return `Error: ${result.content[0]?.text || "Unknown error"}`;
  }
  return result.content.map((c) => c.text).join("\n");
}

/**
 * Create an OpenClaw agent tool from an MCP tool definition
 */
function createAgentTool(
  ctx: OperationsContext,
  definition: { name: string; description: string; inputSchema: Record<string, unknown> },
  handler: (
    ctx: OperationsContext,
    name: string,
    args: unknown
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null>
): AgentTool {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    handler: async (args: Record<string, unknown>) => {
      const result = await handler(ctx, definition.name, args);
      return formatResult(result);
    },
  };
}

/**
 * Main plugin registration function
 */
export default function register(api: OpenClawApi) {
  const { config, logger } = api;

  // Validate required config
  if (!config.userId) {
    logger.error("FiBuKI plugin requires userId in config");
    return;
  }

  // Set emulator env if configured
  if (config.useEmulators) {
    process.env.USE_EMULATORS = "true";
  }

  // Create Firebase context
  const ctx = createContext(config.userId);
  logger.info(`FiBuKI plugin initialized for user ${config.userId}`);

  // Register all tools from each module
  for (const module of toolModules) {
    for (const definition of module.definitions) {
      const tool = createAgentTool(ctx, definition, module.handler);
      api.registerAgentTool(tool);
      logger.debug(`Registered tool: ${tool.name}`);
    }
  }

  // Register a background service for connection management
  api.registerService({
    id: "fibuki-connection",
    start: () => {
      logger.info("FiBuKI connection service started");
    },
    stop: () => {
      logger.info("FiBuKI connection service stopped");
    },
  });

  logger.info(
    `FiBuKI plugin loaded with ${toolModules.reduce((sum, m) => sum + m.definitions.length, 0)} tools`
  );
}

// Export plugin metadata
export const id = "fibuki";
export const name = "FiBuKI Tax Studio";
