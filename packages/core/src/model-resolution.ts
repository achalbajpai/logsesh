const PLACEHOLDER_MODELS = new Set(["<synthetic>", "synthetic", "unknown"]);

export function isPlaceholderModel(model: string | undefined): boolean {
  if (!model?.trim()) return true;
  const normalized = model.trim().toLowerCase();
  if (PLACEHOLDER_MODELS.has(normalized)) return true;
  return normalized.startsWith("<") && normalized.endsWith(">");
}

const PROVIDER_NAMES = new Set(["anthropic", "azure", "google", "openai", "openrouter"]);

export function looksLikeModelId(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    !PROVIDER_NAMES.has(normalized) &&
    /^(claude|codex|gemini|gpt|o\d)/.test(normalized) &&
    /[\d-]/.test(normalized)
  );
}

export class ClaudeModelTracker {
  private weights = new Map<string, number>();

  observe(model: string | undefined, usageWeight = 0): void {
    if (isPlaceholderModel(model) || !model) return;
    const resolvedModel = model.trim();
    const weight = usageWeight > 0 ? usageWeight : 1;
    this.weights.set(resolvedModel, (this.weights.get(resolvedModel) ?? 0) + weight);
  }

  resolve(): string | undefined {
    let best: string | undefined;
    let bestWeight = -1;
    for (const [model, weight] of this.weights) {
      if (weight > bestWeight) {
        best = model;
        bestWeight = weight;
      }
    }
    return best;
  }
}

export class CodexModelTracker {
  private counts = new Map<string, number>();

  observe(model: string | undefined): void {
    if (!model || !looksLikeModelId(model)) return;
    this.counts.set(model, (this.counts.get(model) ?? 0) + 1);
  }

  resolve(): string | undefined {
    let best: string | undefined;
    let bestCount = -1;
    for (const [model, count] of this.counts) {
      if (count > bestCount) {
        best = model;
        bestCount = count;
      }
    }
    return best;
  }
}
