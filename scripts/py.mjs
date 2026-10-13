// Runs the project's own Python (.venv) with the given arguments, falling back to the system Python.
// Used by npm scripts so `npm run api` / `npm run test:api` work without activating the venv.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const venvPython = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'
export const python = () => (existsSync(venvPython) ? venvPython : process.platform === 'win32' ? 'python' : 'python3')

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = spawnSync(python(), process.argv.slice(2), { stdio: 'inherit' })
  if (r.error) console.error(`Could not run Python (${r.error.message}). Double-click Nexora.bat and choose 3 to install.`)
  process.exit(r.status ?? 1)
}
