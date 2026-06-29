import type {
  DebugEnvelopeFormat,
  JsonExportEnvelopeFormat,
  JsonlRecordFormat,
  ListEnvelopeFormat,
  SearchEnvelopeFormat,
  SessionSchemaVersion,
  StatsEnvelopeFormat,
  ToolName,
} from "./constants.js";

export type {
  ToolName,
  SessionSchemaVersion,
  ListEnvelopeFormat,
  SearchEnvelopeFormat,
  StatsEnvelopeFormat,
  DebugEnvelopeFormat,
  JsonExportEnvelopeFormat,
  JsonlRecordFormat,
  DoctorEnvelopeFormat,
} from "./constants.js";

export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "image"; mediaType?: string; bytes?: number; note?: string }
  | { kind: "tool_use"; id: string; name: string; input?: unknown }
  | { kind: "tool_result"; toolUseId: string; output?: unknown; status?: "success" | "error" };

export interface ToolCall {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  status?: "success" | "error";
}

export interface Turn {
  id: string;
  index: number;
  timestamp?: string;
  role: "user" | "assistant" | "tool";
  content: ContentBlock[];
  toolCalls?: ToolCall[];
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface Estimate {
  costUsd: number | null;
  pricingVersion: string;
  pricingAsOf: string;
  pricingSourceUrl?: string;
  model?: string;
  pricingConfidence?: "exact" | "historical" | "fallback" | "unknown";
  pricingProvenance?: PricingProvenance;
  includesCacheTokens: boolean;
  warnings?: string[];
}

export interface PricingProvenance {
  provider: string;
  model: string;
  sourceUrl: string;
  verifiedAt: string;
  effectiveFrom?: string;
  status?: "current" | "historical" | "retired";
  availability?: "available" | "restricted" | "retired";
}

export interface Warning {
  code: string;
  message: string;
  severity: "info" | "warn" | "error";
  scope: "discovery" | "parse" | "export" | "package" | "pricing";
  sourcePath?: string;
  sessionId?: string;
  line?: number;
  cause?: string;
}

export interface Source {
  tool: ToolName;
  adapterVersion: string;
  logFormatVersion?: string;
  sourcePath: string;
}

export interface Session {
  schemaVersion: SessionSchemaVersion;
  id: string;
  source: Source;
  tool: ToolName;
  startedAt?: string;
  endedAt?: string;
  projectPath?: string;
  model?: string;
  usage?: Usage;
  costUsd: number | null;
  estimate?: Estimate;
  turns: Turn[];
  warnings?: Warning[];
}

export interface JsonExportEnvelope<T, W = PublicWarning> {
  format: JsonExportEnvelopeFormat;
  generatedAt: string;
  granularity: "session" | "turn";
  records: T[];
  warnings?: W[];
}

export interface JsonlRecord<T, W = PublicWarning> {
  format: JsonlRecordFormat;
  generatedAt: string;
  record: T;
  warnings?: W[];
}

export type PublicWarning = Omit<Warning, "sourcePath">;
export type PublicContentBlock = Exclude<ContentBlock, { kind: "thinking" }>;
export type PublicTurn = Omit<Turn, "content"> & { content: PublicContentBlock[] };
export type PublicSession = Omit<Session, "turns" | "source" | "warnings"> & {
  turns: PublicTurn[];
  source: Omit<Source, "sourcePath">;
  warnings?: PublicWarning[];
};

type WithReasoning<S> = Omit<S, "turns"> & { turns: Turn[] };
type WithRawPaths<S> = Omit<S, "source" | "warnings"> & { source: Source; warnings?: Warning[] };

export type ReasoningSession = WithReasoning<PublicSession>;
export type RawPathPublicSession = WithRawPaths<PublicSession>;
export type RawPathReasoningSession = WithRawPaths<ReasoningSession>;

export type ExportSession =
  | PublicSession
  | ReasoningSession
  | RawPathPublicSession
  | RawPathReasoningSession;

export type ExportTurn = ExportSession["turns"][number];

export interface SessionSummary {
  id: string;
  tool: ToolName;
  startedAt?: string;
  endedAt?: string;
  projectPath?: string;
  turnCount: number;
  totalTokens?: number;
  costUsd: number | null;
  estimate?: Estimate;
  sourcePath: string;
}

export interface SearchMatch {
  sessionId: string;
  tool: ToolName;
  projectPath?: string;
  timestamp?: string;
  snippets: string[];
  totalHits: number;
}

export interface DailyBurnEntry {
  date: string;
  sessions: number;
  turns: number;
  tokens: number;
}

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  observed: {
    input: boolean;
    output: boolean;
    cacheRead: boolean;
    cacheWrite: boolean;
    reasoning: boolean;
  };
  observedSessionCount: number;
}

export interface StatsReport {
  sessionCount: number;
  turnCount: number;
  totalTokens: number;
  loggedCostUsd: number | null;
  loggedSessionCount: number;
  estimatedCostUsd: number | null;
  estimatedSessionCount: number;
  unpricedSessionCount: number;
  unpricedTokens: number;
  byTool: Record<string, { sessions: number; turns: number; tokens: number }>;
  byProject: Record<string, { sessions: number; turns: number; tokens: number }>;
  mostActiveDays: Array<{ date: string; sessions: number; turns: number }>;
  dailyBurn: DailyBurnEntry[];
  tokenBreakdown: TokenBreakdown;
}

export interface ListEnvelope {
  format: ListEnvelopeFormat;
  generatedAt: string;
  sessions: SessionSummary[];
  warnings?: PublicWarning[];
}

export interface SearchEnvelope {
  format: SearchEnvelopeFormat;
  generatedAt: string;
  matches: SearchMatch[];
  warnings?: PublicWarning[];
}

export interface StatsEnvelope {
  format: StatsEnvelopeFormat;
  generatedAt: string;
  stats: StatsReport;
  warnings?: PublicWarning[];
}

export interface DebugEnvelope {
  format: DebugEnvelopeFormat;
  generatedAt: string;
  session: Session;
  warnings?: PublicWarning[];
}

export interface SessionFile {
  path: string;
  tool: ToolName;
}

export interface ParseOptions {
  maxFileBytes?: number;
  maxTurnChars?: number;
  maxToolOutputChars?: number;
}

export interface DiscoverOptions {
  toolFilter?: ToolName[];
  projectFilter?: string | string[];
  since?: Date;
  until?: Date;
  roots?: Partial<Record<ToolName, string>>;
}

export interface PipelineOptions extends DiscoverOptions, ParseOptions {
  query?: string;
  queryTextFilter?: boolean;
  estimateCost?: boolean;
  maxParseConcurrency?: number;
}

export interface SanitizeOptions {
  includeReasoning?: boolean;
  rawPaths?: boolean;
}

export interface Adapter {
  tool: ToolName;
  adapterVersion: string;
  capabilities: AdapterCapabilities;
  detect(): Promise<boolean>;
  discover(opts: DiscoverOptions): AsyncIterable<SessionFile>;
  parse(file: SessionFile, opts: ParseOptions): AsyncIterable<Session>;
}

export type AdapterCapabilityLevel = "full" | "partial" | "none" | "experimental";

export interface AdapterCapabilities {
  discovery: AdapterCapabilityLevel;
  transcript: AdapterCapabilityLevel;
  toolCalls: AdapterCapabilityLevel;
  usage: AdapterCapabilityLevel;
  model: AdapterCapabilityLevel;
  reasoning: AdapterCapabilityLevel;
  notes?: string[];
}

export type InputContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "image"; mediaType?: string; bytes?: number; note?: string }
  | { kind: "tool_use"; id: string; name: string; input?: unknown };

export interface AddRecordInput {
  fragmentGroupId?: string;
  sourceLine: number;
  role: "user" | "assistant";
  blocks: InputContentBlock[];
  usage?: Usage;
  timestamp?: string;
}

export interface AddToolResultInput {
  toolUseId: string;
  sourceLine: number;
  output?: unknown;
  status?: "success" | "error";
}

export interface SessionBuilderOptions {
  tool: ToolName;
  adapterVersion: string;
  sourcePath: string;
  sessionId: string;
  projectPath?: string;
  model?: string;
  logFormatVersion?: string;
  maxTurnChars?: number;
  maxToolOutputChars?: number;
}
