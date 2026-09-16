export const SESSION_SCHEMA_VERSION = "logsesh.session.v1" as const;
export const LIST_ENVELOPE_FORMAT = "logsesh.list.v1" as const;
export const SEARCH_ENVELOPE_FORMAT = "logsesh.search.v1" as const;
export const STATS_ENVELOPE_FORMAT = "logsesh.stats.v1" as const;
export const DEBUG_ENVELOPE_FORMAT = "logsesh.debug.v1" as const;
export const JSON_EXPORT_ENVELOPE_FORMAT = "logsesh.export.v1" as const;
export const JSONL_RECORD_FORMAT = "logsesh.jsonl.v1" as const;
export const DOCTOR_ENVELOPE_FORMAT = "logsesh.doctor.v1" as const;

export type SessionSchemaVersion = typeof SESSION_SCHEMA_VERSION;
export type ListEnvelopeFormat = typeof LIST_ENVELOPE_FORMAT;
export type SearchEnvelopeFormat = typeof SEARCH_ENVELOPE_FORMAT;
export type StatsEnvelopeFormat = typeof STATS_ENVELOPE_FORMAT;
export type DebugEnvelopeFormat = typeof DEBUG_ENVELOPE_FORMAT;
export type JsonExportEnvelopeFormat = typeof JSON_EXPORT_ENVELOPE_FORMAT;
export type JsonlRecordFormat = typeof JSONL_RECORD_FORMAT;
export type DoctorEnvelopeFormat = typeof DOCTOR_ENVELOPE_FORMAT;

export const LOG_FORMAT_VERSION_UNKNOWN = "unknown" as const;

export const TOOL_NAMES = ["claude-code", "codex", "antigravity", "gemini"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const VALID_TOOLS = new Set<ToolName>(TOOL_NAMES);

export const ADAPTER_VERSIONS = {
  "claude-code": "0.2.0",
  codex: "0.2.0",
  antigravity: "0.2.0",
  gemini: "0.2.0",
} as const satisfies Record<ToolName, string>;

export const DEFAULT_LOG_ROOT_SEGMENTS = {
  "claude-code": [".claude", "projects"],
  codex: [".codex", "sessions"],
  antigravity: [".gemini", "antigravity-cli"],
  gemini: [".gemini", "tmp"],
} as const satisfies Record<ToolName, readonly string[]>;

export const CODEX_ARCHIVE_ROOT_SEGMENTS = [".codex", "archived_sessions"] as const;

export const DEFAULT_PARSE_CONCURRENCY = 4;
export const DOCTOR_CANDIDATE_SCAN_LIMIT = 1000;
export const DOCTOR_SAMPLE_FILE_LIMIT = 3;
export const DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_MAX_RECORD_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LARGE_FILE_THRESHOLD = 512 * 1024 * 1024;
export const DEFAULT_DEGRADED_HEAD_BYTES = 64 * 1024 * 1024;
export const DEFAULT_DEGRADED_TAIL_BYTES = 64 * 1024 * 1024;
export const DEFAULT_READER_CHUNK_BYTES = 64 * 1024;
export const PRICING_STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
export const EXPORT_FILE_MODE = 0o600;
export const INDEX_DIR_MODE = 0o700;
export const INDEX_FILE_MODE = 0o600;
export const BINARY_ELIDE_MIN_CHARS = 512;

export const MS_PER_DAY = 86400000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_MINUTE = 60000;

export const CODEX_LOG_TYPES = new Set([
  "session_meta",
  "response_item",
  "event_msg",
  "token_count",
  "token_usage_record",
  "turn_context",
  "world_state",
  "compacted",
  "inter_agent_communication_metadata",
]);
export const CLAUDE_LOG_TYPES = new Set(["user", "assistant", "system", "summary"]);
export const SNIFF_HEAD_BYTES = 8192;
export const DEFAULT_INFER_TOOL: ToolName = "claude-code";

export const PLACEHOLDER_MODELS = new Set(["<synthetic>", "synthetic", "unknown"]);
export const PROVIDER_NAMES = new Set(["anthropic", "azure", "google", "openai", "openrouter"]);

export const KNOWN_QUERY_FIELDS = new Set([
  "project",
  "tool",
  "model",
  "agent",
  "parent",
  "branch",
  "toolcall",
]);
export const QUERY_FIELD_PATTERN = /\b([a-z][a-z0-9_-]*):("([^"]*)"|(\S+))/gi;

export const TOKEN_CATEGORY_FIELDS = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheWrite: "cacheWriteTokens",
  reasoning: "reasoningTokens",
} as const;

export const MOST_ACTIVE_DAYS_LIMIT = 10;
export const UNKNOWN_PROJECT_LABEL = "unknown";

export const DEFAULT_MAX_SNIPPETS = 3;
export const SNIPPET_CONTEXT_RADIUS = 60;
export const SESSION_PREVIEW_MAX_CHARS = 120;

export const REDACTED_PLACEHOLDER = "[REDACTED]";

export const BUILTIN_REDACT_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /sk_(?:test|live)_[A-Za-z0-9]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /sk-ant-[A-Za-z0-9\-_]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9\-_]{20,}/g,
  /npm_[A-Za-z0-9]{36,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:^|[\s;])(?:API_KEY|SECRET|PASSWORD|TOKEN)\s*=\s*[^\s#]+/gim,
  /xai-[A-Za-z0-9]{20,}/g,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /ya29\.[0-9A-Za-z\-_.]+/g,
  /gh[uor]_[A-Za-z0-9]{20,}/g,
  /xoxe\.xoxp-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
];

export const CLAUDE_IGNORED_LINE_TYPES = new Set([
  "queue-operation",
  "file-history-snapshot",
  "file-history-delta",
  "ai-title",
  "last-prompt",
  "attachment",
  "system",
  "summary",
  "atis-latch",
  "mode",
  "permission-mode",
  "bridge-session",
  "pr-link",
  "frame-link",
  "artifact-autoreact-ledger",
  "artifact-comment-monitor",
]);

export const CODEX_IGNORED_LINE_TYPES = new Set([
  "world_state",
  "compacted",
  "inter_agent_communication_metadata",
]);

export const CODEX_IGNORED_PAYLOAD_TYPES = new Set([
  "item_completed",
  "task_started",
  "task_complete",
  "thread_settings_applied",
  "turn_aborted",
  "thread_goal_updated",
]);

export const GEMINI_MESSAGE_TYPES = new Set(["user", "gemini", "info", "error", "warning"]);

export const EXPORT_DEFAULTS = {
  transcriptRedactDefault: true,
  summaryCsvRedactRequired: false,
  anonymizePathsDefault: true,
} as const;
