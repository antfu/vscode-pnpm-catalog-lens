import { defineConfigObject } from 'reactive-vscode'
import * as Meta from './generated/meta'

export const config = defineConfigObject<Meta.ScopedConfigKeyTypeMap>(
  Meta.scopedConfigs.scope,
  Meta.scopedConfigs.defaults,
)

const backwardsConfig = defineConfigObject<Meta.ScopedConfigKeyTypeMap>(
  'pnpmCatalogLens',
  Meta.scopedConfigs.defaults,
)

export function enabled() {
  return config.enabled && backwardsConfig.enabled
}

export function hover() {
  return config.hover && backwardsConfig.hover
}

export function namedCatalogsColors() {
  return config.namedCatalogsColors && backwardsConfig.namedCatalogsColors
}

export function namedCatalogsColorsSalt() {
  return config.namedCatalogsColorsSalt || backwardsConfig.namedCatalogsColorsSalt
}

export function namedCatalogsLabel() {
  return config.namedCatalogsLabel && backwardsConfig.namedCatalogsLabel
}
