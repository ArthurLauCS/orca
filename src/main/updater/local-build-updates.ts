import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// orca-custom writes this marker into resources/ of every package it builds. Such a package must
// never replace itself with the official release; packages without it behave as upstream.
export const LOCAL_CUSTOM_BUILD_MARKER = 'orca-custom-build.json'

export function isSelfUpdateEnabled(): boolean {
  if (!app.isPackaged) {
    return false
  }
  const resources = process.resourcesPath
  return !(resources && existsSync(join(resources, LOCAL_CUSTOM_BUILD_MARKER)))
}
