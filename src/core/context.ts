import type { CatalogueScope, CopyItem, LoopConfig, MarketingContext } from '../types.js';

const keyIncludes = (item: CopyItem, term: string): boolean =>
  item.catalogueKey.toLowerCase().includes(term);

function firstText(items: CopyItem[], terms: string[]): string | undefined {
  for (const term of terms) {
    const item = items.find((candidate) => keyIncludes(candidate, term));
    if (item) return item.text;
  }
  return undefined;
}

export function buildMarketingContext(
  scope: CatalogueScope,
  items: CopyItem[],
  config: LoopConfig,
): MarketingContext {
  return {
    sourceLocale: scope.sourceLocale,
    messagesDir: scope.messagesDir,
    layout: scope.layout,
    namespaces: [...new Set(items.map((item) => item.catalogueKey.split('.')[0]).filter((namespace): namespace is string => Boolean(namespace)))].sort(),
    currentTagline: firstText(items, ['tagline', 'hero.headline', 'headline']),
    currentDescription: firstText(items, ['description', 'subhead', 'subtitle']),
    audience: config.audience,
    allowedClaims: [...config.allowedClaims],
    generatedAt: new Date().toISOString(),
  };
}
