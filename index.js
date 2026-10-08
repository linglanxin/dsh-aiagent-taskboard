// dsh-aiagent-taskboard - Host half.
//
// One route: GET /api/aiagent-taskboard/state -> a compact snapshot of what the
// local AI agents are doing. Three cheap sources, no daemon of our own:
//
// The route MUST declare `requestBody: 'buffered'`. The /api bridge picks how it
// builds the fetch Request from that field; 'buffered' is also its fallback when
// the path is unknown. A registered route that leaves the field undefined makes
// the bridge take the streaming branch, where `new Request(url, {method: 'GET',
// body: <stream>})` throws `Request with GET/HEAD method cannot have body`; the
// web server catches that and answers the browser with a bare HTTP 400.
//
//   1. F:\aiagent\.state\events.jsonl  - append-only events the CLI wrappers write
//      (codex.cmd / claude.cmd / conductor.cmd / ai-od.cmd; see aiagent-log.ps1).
//   2. The Open Design daemon over HTTP. Since 0.24.1 it listens on a RANDOM local
//      port, so the port is discovered per poll (daemon-health.json pid -> netstat,
//      then a short candidate list), and a failure just degrades to "offline".
//   3. The session folders F:\aiagent\<agent>\<session> - the "who is working where".
//
// Everything is best-effort: a missing file or a closed app yields an empty list,
// never an exception.
//
// Configuration, per setting, in priority order: the environment variable
// (AIAGENT_HOME / AIAGENT_STATE_DIR / OD_DATA_DIR / AIAGENT_SESSION_ROOTS),
// then <plugin>/local.config.json (git-ignored; copy local.config.example.json),
// then a portable default derived from the user's home directory.

import { appendFile, readFile, readdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const name = 'dsh-aiagent-taskboard'

const ROUTE = '/api/aiagent-taskboard/state'
const execFileAsync = promisify(execFile)

const HERE = dirname(fileURLToPath(import.meta.url))

/** Optional per-install settings stored next to the plugin; missing file is fine. */
function readLocalConfig() {
  try {
    const parsed = JSON.parse(readFileSync(join(HERE, 'local.config.json'), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const LOCAL = readLocalConfig()
/** Root holding the agent session folders; the event log lives in <root>/.state. */
const AGENT_HOME = process.env.AIAGENT_HOME || LOCAL.agentHome || join(homedir(), 'aiagent')
const STATE_DIR = process.env.AIAGENT_STATE_DIR || LOCAL.stateDir || join(AGENT_HOME, '.state')
const EVENTS_FILE = join(STATE_DIR, 'events.jsonl')
const OD_DATA_DIR =
  process.env.OD_DATA_DIR ||
  LOCAL.odDataDir ||
  (process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Roaming', 'Open Design', 'namespaces', 'release-stable-win', 'data')
    : join(homedir(), '.config', 'Open Design', 'namespaces', 'release-stable-win', 'data'))
const LOCAL_ROOTS = Array.isArray(LOCAL.sessionRoots) ? LOCAL.sessionRoots.join(';') : LOCAL.sessionRoots
const SESSION_ROOTS = String(
  process.env.AIAGENT_SESSION_ROOTS ||
    LOCAL_ROOTS ||
    [join(AGENT_HOME, 'codex'), join(AGENT_HOME, 'claudecode'), join(AGENT_HOME, 'dsh')].join(';'),
)
  .split(';')
  .map((value) => value.trim())
  .filter((value) => value !== '')
const CANDIDATE_PORTS = [7456, 6179, 8766]
const AGENT_LABEL = { codex: 'Codex', claudecode: 'Claude Code', dsh: 'DSH', opendesign: 'Open Design' }
const DAY_MS = 24 * 60 * 60 * 1000

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Read the tail of the event log; every malformed line is skipped. */
export async function readEvents(limit = 2000) {
  let text
  try {
    text = await readFile(EVENTS_FILE, 'utf8')
  } catch {
    return []
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '')
  const tail = lines.slice(-limit)
  const events = []
  for (const line of tail) {
    try {
      const parsed = JSON.parse(line)
      if (parsed && typeof parsed === 'object') events.push(parsed)
    } catch {
      /* ignore a torn line */
    }
  }
  events.sort((a, b) => (asNumber(a.ts) || 0) - (asNumber(b.ts) || 0))
  return events
}

/** Fold start/end events into one record per task (latest state wins). */
export function foldTasks(events) {
  const byId = new Map()
  for (const event of events) {
    const id = typeof event.taskId === 'string' && event.taskId !== '' ? event.taskId : null
    if (id === null) continue
    const current = byId.get(id) || {
      taskId: id,
      agent: event.agent || 'unknown',
      label: event.label || event.note || id,
      dir: event.dir || '',
      status: 'running',
      startedAt: asNumber(event.ts) || Date.now(),
      endedAt: null,
      durationMs: null,
      exitCode: null,
      note: '',
      artifacts: [],
    }
    if (event.phase === 'start') {
      current.startedAt = Math.min(current.startedAt, asNumber(event.ts) || current.startedAt)
      current.status = 'running'
      if (event.label) current.label = event.label
      if (event.dir) current.dir = event.dir
    } else if (event.phase === 'end') {
      current.endedAt = asNumber(event.ts) || Date.now()
      current.exitCode = asNumber(event.exitCode)
      current.status = event.status || (current.exitCode === 0 ? 'ok' : 'failed')
      current.durationMs = current.endedAt - current.startedAt
      if (Array.isArray(event.artifacts) && event.artifacts.length > 0) current.artifacts = event.artifacts
    } else if (event.phase === 'artifact') {
      if (typeof event.path === 'string' && event.path !== '') current.artifacts.push(event.path)
    }
    if (event.note) current.note = String(event.note)
    byId.set(id, current)
  }
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt)
}

/** Port of the Open Design daemon: read the pid it wrote, then its listening port. */
export async function discoverOpenDesignBase() {
  const candidates = []
  try {
    const raw = await readFile(join(OD_DATA_DIR, 'diagnostics', 'daemon-health.json'), 'utf8')
    const health = JSON.parse(raw)
    const pid = asNumber(health && health.pid)
    if (pid !== null) {
      try {
        const { stdout } = await execFileAsync('netstat', ['-ano'], { timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
        for (const line of stdout.split(/\r?\n/)) {
          const parts = line.trim().split(/\s+/)
          if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP') continue
          if (!/LISTENING/i.test(parts[3])) continue
          if (Number(parts[4]) !== pid) continue
          const port = Number(String(parts[1]).split(':').pop())
          if (Number.isInteger(port) && port > 0) candidates.push(port)
        }
      } catch {
        /* netstat is optional */
      }
    }
  } catch {
    /* no health file: the app is probably closed */
  }
  for (const port of CANDIDATE_PORTS) candidates.push(port)
  for (const port of [...new Set(candidates)]) {
    const base = 'http://127.0.0.1:' + port
    try {
      const response = await fetch(base + '/api/daemon/status', { signal: AbortSignal.timeout(1500) })
      if (!response.ok) continue
      const status = await response.json()
      if (status && (status.ok === true || typeof status.dataDir === 'string')) {
        return { base, port, version: typeof status.version === 'string' ? status.version : '', plugins: asNumber(status.installedPlugins) }
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/** Open Design routines + their latest runs, mapped onto the same task shape. */
export async function collectOpenDesign() {
  const daemon = await discoverOpenDesignBase()
  if (daemon === null) return { daemon: null, tasks: [] }
  const tasks = []
  try {
    const response = await fetch(daemon.base + '/api/routines', { signal: AbortSignal.timeout(3000) })
    if (response.ok) {
      const payload = await response.json()
      const routines = Array.isArray(payload && payload.routines) ? payload.routines.slice(0, 12) : []
      for (const routine of routines) {
        const task = {
          taskId: 'od:' + String(routine.id),
          agent: 'opendesign',
          label: String(routine.name || 'Open Design 任务'),
          dir: '',
          status: 'idle',
          startedAt: asNumber(routine.createdAt) || 0,
          endedAt: null,
          durationMs: null,
          exitCode: null,
          note: '',
          artifacts: [],
          source: 'opendesign',
          projectId: '',
        }
        try {
          const runsResponse = await fetch(daemon.base + '/api/routines/' + encodeURIComponent(routine.id) + '/runs?limit=1', {
            signal: AbortSignal.timeout(3000),
          })
          if (runsResponse.ok) {
            const runs = await runsResponse.json()
            const run = Array.isArray(runs && runs.runs) ? runs.runs[0] : null
            if (run) {
              const startedAt = asNumber(run.startedAt) || task.startedAt
              task.startedAt = startedAt
              task.status = run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'failed' : 'running'
              task.endedAt = asNumber(run.completedAt)
              task.durationMs = task.endedAt === null ? null : task.endedAt - startedAt
              task.note = typeof run.summary === 'string' ? run.summary : ''
              task.projectId = String(run.projectId || '')
              task.agentRunId = String(run.agentRunId || '')
            }
          }
        } catch {
          /* keep the routine without its run */
        }
        tasks.push(task)
      }
    }
  } catch {
    /* routines are optional */
  }
  return { daemon, tasks }
}

/** Session folders under F:\aiagent\<agent>\<name>, newest first. */
export async function scanSessions(perRoot = 8) {
  const sessions = []
  for (const root of SESSION_ROOTS) {
    const agent = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || root
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    const dirs = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue
      const path = join(root, entry.name)
      try {
        const info = await stat(path)
        dirs.push({ agent, name: entry.name, path, mtimeMs: info.mtimeMs })
      } catch {
        /* skip */
      }
    }
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)
    sessions.push(...dirs.slice(0, perRoot))
  }
  return sessions.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/** The whole snapshot, cached briefly so a polling UI stays cheap. */
export async function buildState({ now = Date.now() } = {}) {
  if (cache !== null && now - cache.at < CACHE_MS) return cache.value
  const events = await readEvents()
  const tasks = foldTasks(events)
  const openDesign = await collectOpenDesign()
  const sessions = await scanSessions()
  const all = [...tasks, ...openDesign.tasks].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, 60)
  const fixed = ['codex', 'claudecode', 'dsh', 'opendesign']
  const extras = [...new Set(all.map((task) => task.agent))].filter((id) => !fixed.includes(id))
  const agents = [...fixed, ...extras].map((id) => {
    const own = all.filter((task) => task.agent === id)
    const today = own.filter((task) => (task.startedAt || 0) > now - DAY_MS)
    return {
      id,
      label: AGENT_LABEL[id] || id,
      running: own.filter((task) => task.status === 'running').length,
      todayOk: today.filter((task) => task.status === 'ok').length,
      todayFailed: today.filter((task) => task.status === 'failed').length,
      lastAt: own.length > 0 ? own[0].startedAt : null,
    }
  })
  const value = {
    generatedAt: now,
    stateDir: STATE_DIR,
    eventCount: events.length,
    opendesign: openDesign.daemon === null ? { ok: false } : { ok: true, port: openDesign.daemon.port, version: openDesign.daemon.version, plugins: openDesign.daemon.plugins },
    agents,
    tasks: all,
    sessions,
  }
  cache = { at: now, value }
  return value
}

let cache = null
const CACHE_MS = 4000

export function apply(ctx) {
  // Best-effort load marker: tells us which copy of the host half the app loaded.
  void appendFile(join(STATE_DIR, 'host-loads.log'), new Date().toISOString() + ' taskboard-host v2 GET+buffered\n', 'utf8').catch(() => {})
  ctx.inject(['connection'], (pluginCtx) => {
    pluginCtx.connection.fetch.register({
      path: ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch() {
        try {
          return Response.json(await buildState())
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
        }
      },
    })
  })
}