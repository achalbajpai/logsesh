import { ANSI_ESCAPE_PATTERN, ANSI_RESET, CHART_BLOCK, CHART_SPARK_CHARS } from "../constants.js";
import { visibleWidth } from "./layout.js";

export function hbar(value: number, max: number, width: number, fill = CHART_BLOCK): string {
  if (width <= 0 || max <= 0 || value <= 0) return "";
  const filled = Math.min(width, Math.max(1, Math.round((value / max) * width)));
  return fill.repeat(filled);
}

export function sparkline(values: number[], chars = CHART_SPARK_CHARS): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === 0) return "";
  if (min === max) {
    return chars[0]!.repeat(values.length);
  }
  return values
    .map((value) => {
      const index = Math.round(((value - min) / (max - min)) * (chars.length - 1));
      return chars[index]!;
    })
    .join("");
}

export interface StackedSegment {
  value: number;
  paint: (text: string) => string;
}

export function stackedBar(segments: StackedSegment[], width: number): string {
  const positive = segments.filter((segment) => segment.value > 0);
  const total = positive.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0 || width <= 0) return "";

  let used = 0;
  let bar = "";
  for (let i = 0; i < positive.length; i++) {
    const segment = positive[i]!;
    const segmentWidth =
      i === positive.length - 1 ? width - used : Math.floor((segment.value / total) * width);
    if (segmentWidth <= 0) continue;
    bar += segment.paint(CHART_BLOCK.repeat(segmentWidth));
    used += segmentWidth;
  }
  return bar;
}

export function truncateAnsi(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  let out = "";
  let visible = 0;
  let styled = false;
  for (let i = 0; i < text.length && visible < width; ) {
    const esc = ANSI_ESCAPE_PATTERN.exec(text.slice(i));
    if (esc) {
      out += esc[0];
      styled = true;
      i += esc[0].length;
      continue;
    }
    out += text[i];
    visible++;
    i++;
  }
  return styled ? out + ANSI_RESET : out;
}

export function barRow(
  label: string,
  bar: string,
  valueText: string,
  totalWidth: number,
  labelWidth: number,
): string {
  const gap = 1;
  const valueWidth = visibleWidth(valueText);
  const barSlot = Math.max(0, totalWidth - labelWidth - gap - gap - valueWidth);
  const barText = truncateAnsi(bar, barSlot);
  const padding = Math.max(0, barSlot - visibleWidth(barText));
  return `${label.padEnd(labelWidth)} ${barText}${" ".repeat(padding)} ${valueText}`;
}

export function clampRow(text: string, width: number): string {
  return truncateAnsi(text, width);
}
