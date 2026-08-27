export const CORE_VERSION = "0.1.0";

export { runAgentTurn } from "./agent/loop.js";
export { executeToolCall } from "./agent/executor.js";
export type { AgentEvent } from "./agent/events.js";
export {
  loadConfig,
  globalSettingsPath,
  projectSettingsPath,
  getAutoUpdatePreference,
  setAutoUpdatePreference,
  DEFAULT_MAX_CONTEXT_TOKENS,
} from "./config/loader.js";
export type { EngineConfig, ResolvedConfig } from "./config/loader.js";
export { SettingsSchema } from "./config/schema.js";
export type { Settings, McpServerConfig, ModelEntry } from "./config/schema.js";
export {
  resolveEngineConfigForModel,
  listModelOptions,
  findModelOption,
} from "./config/model-options.js";
export type { ModelOption } from "./config/model-options.js";
export { persistPlan, plansDir, prunePlans } from "./plans/store.js";
export type { PersistedPlan } from "./plans/store.js";
export { AllowAllGate } from "./permissions/gate.js";
export type { PermissionGate, PermissionRequest, PermissionDecision } from "./permissions/gate.js";
export { PolicyGate } from "./permissions/policy.js";
export type { PermissionMode, ApprovalResponse, PolicyGateOptions } from "./permissions/policy.js";
export {
  matchesSecretPath,
  isSecretFilename,
  SECRET_FILE_GLOBS,
  SECRET_DIR_NAMES,
  SECRET_IGNORE_GLOBS,
} from "./permissions/secret-paths.js";
export { connectAllMcpServers } from "./mcp/manager.js";
export type { McpConnectResult } from "./mcp/manager.js";
export { createProviderAdapter } from "./providers/registry.js";
export type { ProviderAdapter } from "./providers/types.js";
export { createSession } from "./session/types.js";
export type { Message, Session } from "./session/types.js";
export {
  persistSessionHeader,
  persistMessage,
  persistSessionRename,
  persistSessionUsage,
  pruneSessions,
  loadSession,
  listSessions,
} from "./session/store.js";
export type { SessionSummary } from "./session/store.js";
export { buildToolSystemPrompt } from "./tool-protocol/grammar.js";
export { ToolCallStreamParser } from "./tool-protocol/stream-parser.js";
export { finalize, resolveEnvelope } from "./tool-protocol/resolve.js";
export type { ParsedToolCall, ToolCallParseError } from "./tool-protocol/types.js";
export {
  buildEnvelopeSchema,
  parseStructuredEnvelope,
  ENVELOPE_SCHEMA_NAME,
} from "./tool-protocol/structured-schema.js";
export type { StructuredEnvelope, StructuredToolCall } from "./tool-protocol/structured-schema.js";
export { readFileTool } from "./tools/read.js";
export { writeFileTool } from "./tools/write.js";
export { editFileTool } from "./tools/edit.js";
export { bashTool } from "./tools/bash.js";
export { grepTool } from "./tools/grep.js";
export { globTool } from "./tools/glob.js";
export { webFetchTool } from "./tools/web-fetch.js";
export { createExitPlanModeTool } from "./tools/exit-plan-mode.js";
export { createAskUserQuestionTool } from "./tools/ask-user-question.js";
export type { UserQuestionRequest, UserQuestionOption } from "./tools/ask-user-question.js";
export { createTaskTool } from "./tools/task.js";
export { buildAgentTools } from "./tools/build-agent-tools.js";
export { ToolRegistry, textResult } from "./tools/types.js";
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  DiffPreview,
} from "./tools/types.js";
export { resolveToolPath } from "./tools/resolve-path.js";
export type { ResolvedToolPath } from "./tools/resolve-path.js";
export {
  estimateTokens,
  estimateSessionTokens,
  sessionContextTokens,
  shouldCompact,
  compactSession,
} from "./session/context-manager.js";
export { checkForUpdate } from "./update/check-for-update.js";
export type { UpdateCheckResult } from "./update/check-for-update.js";
export { runSelfUpdate, detectPackageManager } from "./update/self-update.js";
export type { SelfUpdateResult, PackageManager } from "./update/self-update.js";
