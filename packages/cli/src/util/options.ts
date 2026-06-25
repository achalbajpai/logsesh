export interface SharedCommandOptions {
  tool?: string;
  project?: string;
  since?: string;
  until?: string;
  query?: string;
  json?: boolean;
  estimateCost?: boolean;
  maxFileBytes?: number;
  maxTurnChars?: number;
  maxToolOutputChars?: number;
  roots?: string[];
}
