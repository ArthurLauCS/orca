import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, Notification } from 'electron'
import { LOCAL_CUSTOM_BUILD_MARKER } from './local-build-updates'

// Paths orca-custom writes into the marker of every build it stages.
type LocalCustomBuildMarker = {
  node?: string
  syncScript?: string
  swapScript?: string
  noticeFile?: string
  nextBuildFile?: string
}

const FIRST_CHECK_DELAY_MS = 2 * 60_000
const CHECK_INTERVAL_MS = 60 * 60_000
let started = false

function readMarker(): LocalCustomBuildMarker | null {
  const resources = process.resourcesPath
  if (!app.isPackaged || !resources) {
    return null
  }
  try {
    return JSON.parse(readFileSync(join(resources, LOCAL_CUSTOM_BUILD_MARKER), 'utf8'))
  } catch {
    return null
  }
}

function runScript(node: string, script: string, args: string[], onExit?: () => void): void {
  const child = spawn(node, [script, ...args], {
    cwd: dirname(script),
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  })
  child.on('error', (error) => console.warn(`[local-custom] could not start ${script}`, error))
  if (onExit) {
    child.on('exit', onExit)
  }
  child.unref()
}

function showNotice(file: string): void {
  if (!existsSync(file)) {
    return
  }
  try {
    const { title, body } = JSON.parse(readFileSync(file, 'utf8'))
    rmSync(file, { force: true })
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  } catch (error) {
    console.warn('[local-custom] unreadable notice', error)
  }
}

/** Custom builds run orca-custom's sync while open and switch to a newly staged build on quit. */
export function startLocalCustomSync(): void {
  if (started) {
    return
  }
  const { node, syncScript, swapScript, noticeFile, nextBuildFile } = readMarker() ?? {}
  if (!node || !syncScript || !existsSync(node) || !existsSync(syncScript)) {
    return
  }
  started = true
  // sync.mjs works at most once a day; hourly calls cover an Orca left open overnight.
  let running = false
  const check = (): void => {
    if (running) {
      return
    }
    running = true
    runScript(node, syncScript, [], () => {
      running = false
      if (noticeFile) {
        showNotice(noticeFile)
      }
    })
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS).unref()
  setInterval(check, CHECK_INTERVAL_MS).unref()
  if (swapScript && nextBuildFile) {
    app.on('will-quit', () => {
      if (existsSync(nextBuildFile)) {
        runScript(node, swapScript, ['--after', String(process.pid)])
      }
    })
  }
}
