export const TERM_MAX_WIDTH = 120;
export const TERM_DEFAULT_WIDTH = 80;

export const EXPORT_FILE_MODE = 0o600;
export const MS_PER_DAY = 86400000;
export const MS_PER_HOUR = 3600000;
export const MS_PER_MINUTE = 60000;

export const LIST_COL_GAP = 2;

export const STATS_PROJECT_LIMIT = 10;
export const STATS_DAILY_BURN_WIDE = 30;
export const STATS_DAILY_BURN_NARROW = 14;
export const STATS_NARROW_WIDTH = 70;
export const STATS_PROJECT_LABEL_MIN = 12;

export const CHART_BLOCK = "█";
export const CHART_SPARK_CHARS = "▁▂▃▄▅▆▇█";

export const ANSI_ESC = String.fromCharCode(27);
export const ANSI_RESET = `${ANSI_ESC}[0m`;
export const ANSI_ESCAPE_PATTERN = new RegExp(`^${ANSI_ESC}\\[[0-9;]*m`);

export const EXPORT_FORMATS = ["json", "jsonl", "markdown", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const LOGSESH_PLAIN_ENV = "LOGSESH_PLAIN";
export const LOGSESH_PLAIN_VALUE = "1";
