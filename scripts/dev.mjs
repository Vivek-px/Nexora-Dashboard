// `npm run dev`: starts the Python server (port 8000, live reload) if it is not already running,
// then the Vite dashboard on port 5173. Ctrl+C stops both.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { python, venvPython } from './py.mjs'

const open = (port) => new Promise((ok) => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); ok(true) }); s.on('error', () => ok(false)) })
const children = []
// On Windows the live-reload server runs a child process; end the whole tree so port 8000 is freed.
const stop = () => { for (const c of children) if (c.exitCode === null) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill() } }
process.on('SIGINT', () => { stop(); process.exit(0) })
process.on('SIGTERM', () => { stop(); process.exit(0) })

if (await open(8000)) {
  console.log('[Nexora] Server already running on http://127.0.0.1:8000')
} else {
  if (!existsSync(venvPython)) console.warn('[Nexora] No .venv yet – double-click Nexora.bat and choose 3 to install the server packages.')
  const api = spawn(python(), ['-m', 'uvicorn', 'app:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000', '--reload'], { stdio: 'inherit' })
  api.on('exit', (code) => { if (code) console.error(`[Nexora] The Python server stopped (exit ${code}). See the messages above.`) })
  children.push(api)
  for (let i = 0; i < 60 && !(await open(8000)); i++) await new Promise((r) => setTimeout(r, 500))
}
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' })
children.push(vite)
vite.on('exit', (code) => { stop(); process.exit(code ?? 0) })
