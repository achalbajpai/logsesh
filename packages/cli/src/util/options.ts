export interface SharedCommandOptions {
  tool?: string;
  project?: string | string[];
  since?: string;
  until?: string;
  query?: string;
  json?: boolean;
  plain?: boolean;
  color?: boolean;
  noColor?: boolean;
  estimateCost?: boolean;
  maxFileBytes?: number;
  maxTurnChars?: number;
  maxToolOutputChars?: number;
  roots?: string[];
}
