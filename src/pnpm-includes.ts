const catalogSettings = new Set(['catalog', 'catalogs'])

export function getCatalogIncludePaths(include: unknown): string[] {
  if (!include || typeof include !== 'object' || Array.isArray(include))
    return []

  return Object.entries(include)
    .filter(([path, settings]) => {
      if (!isLocalYamlPath(path))
        return false
      return settings === '*' || (Array.isArray(settings) && settings.some(setting => typeof setting === 'string' && catalogSettings.has(setting)))
    })
    .map(([path]) => path)
}

function isLocalYamlPath(path: string) {
  return /^\.{1,2}\/.+\.ya?ml$/i.test(path)
}
