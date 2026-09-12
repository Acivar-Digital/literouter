import { getAllProviders } from "../config/providers";
import type { ProviderConfigEntry } from "../config/schema";
import { AnthropicDirectStrategy } from "./strategies/anthropic_direct";
import { GcpGuardedStrategy } from "./strategies/gcp_guarded";
import { NativeCascadeStrategy } from "./strategies/native_cascade";
import { StandardStrategy } from "./strategies/standard";
import { ZenSingleFlightStrategy } from "./strategies/zen_single_flight";
import type { ProviderExecutionStrategy } from "./strategy";

type StrategyFactory = () => ProviderExecutionStrategy;

const strategyMap = new Map<string, ProviderExecutionStrategy>();
const factories = new Map<string, StrategyFactory>();

function registerDefaultFactories(): void {
  if (!factories.has("standard")) {
    factories.set("standard", () => new StandardStrategy());
  }
  if (!factories.has("native_cascade")) {
    factories.set("native_cascade", () => new NativeCascadeStrategy());
  }
  if (!factories.has("gcp_guarded")) {
    factories.set("gcp_guarded", () => new GcpGuardedStrategy());
  }
  if (!factories.has("zen_single_flight")) {
    factories.set("zen_single_flight", () => new ZenSingleFlightStrategy());
  }
  if (!factories.has("anthropic_direct")) {
    factories.set("anthropic_direct", () => new AnthropicDirectStrategy());
  }
}

registerDefaultFactories();

export function registerStrategyFactory(
  type: string,
  factory: () => ProviderExecutionStrategy
): void {
  factories.set(type.toLowerCase(), factory);
}

export function unregisterStrategyFactory(type: string): void {
  factories.delete(type.toLowerCase());
}

export function initStrategyRegistry(): void {
  registerDefaultFactories();
  strategyMap.clear();
  let providers: readonly ProviderConfigEntry[] = [];
  try {
    providers = getAllProviders();
  } catch {
    providers = [];
  }

  for (const prov of providers) {
    const strategyType = (prov.strategy ?? "standard").toLowerCase();
    const factory = factories.get(strategyType);
    if (factory) {
      strategyMap.set(prov.code.toLowerCase(), factory());
    } else {
      throw new Error(
        `Unknown strategy "${strategyType}" for provider "${prov.code}"`
      );
    }
  }
}

export function getStrategy(providerCode: string): ProviderExecutionStrategy {
  const norm = providerCode.toLowerCase();
  const strategy = strategyMap.get(norm);
  if (!strategy) {
    throw new Error(`[StrategyRegistry] No strategy registered for provider "${providerCode}". Check config/providers.json strategy field.`);
  }
  return strategy;
}

export function resetStrategyRegistry(): void {
  strategyMap.clear();
  factories.clear();
  registerDefaultFactories();
}
