import { execFileSync } from 'node:child_process'
import { SMOKE_CONTAINER } from './playwright.config.ts'

/** The docker mode's container stops with the run (a no-op in the bundle mode). */
export default function teardown(): void {
  if ((process.env.BMA_SMOKE ?? 'bundle') !== 'docker') return
  try {
    execFileSync('docker', ['rm', '-f', SMOKE_CONTAINER], { stdio: 'ignore' })
  } catch {
    // already gone
  }
}
