const THINKING_TO_REASONING: Record<string, string> = {
  none: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export function extractThinkingLevel(data: any): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (data.google?.thinking_config) {
    return data.google.thinking_config.thinking_level;
  } else if (data.thinkingConfig?.thinkingLevel) {
    return data.thinkingConfig.thinkingLevel;
  } else if (data.reasoning_effort) {
    return data.reasoning_effort;
  } else if (
    typeof data.thinking === "object" &&
    data.thinking?.type === "enabled"
  ) {
    return "minimal";
  }
  return undefined;
}

export function applyReasoningEffort(data: any, level: string | undefined): void {
  const isGemma = String(data.model || "").toLowerCase().includes("gemma");
  if (!isGemma && !data.reasoning_effort) {
    data.reasoning_effort = level ? THINKING_TO_REASONING[level] || "low" : "low";
  }
  delete data.google;
  delete data.thinkingConfig;
  delete data.thinking_config;
  delete data.thinking;
  delete data.thinkingBudget;
}

export function translateGoogleThinking(data: any): any {
  if (!data || typeof data !== "object") return data;
  const level = extractThinkingLevel(data);
  applyReasoningEffort(data, level);
  return data;
}
