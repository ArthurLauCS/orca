import { app } from 'electron'

// Local custom build (sidebar hierarchy): never self-update, or the official release would
// replace it. Behaves like a dev run for every updater entry point.
const LOCAL_CUSTOM_BUILD = true

export function isSelfUpdateEnabled(): boolean {
  return app.isPackaged && !LOCAL_CUSTOM_BUILD
}
