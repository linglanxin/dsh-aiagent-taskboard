// Offline host test: event folding, statuses, durations, artifacts, agent roll-up.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'taskboard-host-'))
process.env.AIAGENT_STATE_DIR = dir
process.env.AIAGENT_SESSION_ROOTS = join(dir, 'sessions')
process.env.OD_DATA_DIR = join(dir, 'od-data')

const events = [
  { ts: 1000, taskId: 't1', agent: 'codex', phase: 'start', dir: 'F:\\aiagent\\codex\\a' },
  { ts: 3000, taskId: 't1', agent: 'codex', phase: 'artifact', path: 'F:\\x\\poster.png' },
  { ts: 6000, taskId: 't1', agent: 'codex', phase: 'end', dir: 'F:\\aiagent\\codex\\a', exitCode: 0, status: 'ok' },
  { ts: 7000, taskId: 't2', agent: 'claudecode', phase: 'start', dir: 'F:\\aiagent\\claudecode\\b' },
  { ts: 8000, taskId: 't3', agent: 'conductor', phase: 'start', dir: 'F:\\aiagent' },
  { ts: 9000, taskId: 't3', agent: 'conductor', phase: 'end', exitCode: 1, status: 'failed' },
]
await writeFile(join(dir, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8')

const mod = await import('../index.js')
const read = await mod.readEvents()
assert.equal(read.length, 6, 'all six events parse')

const tasks = mod.foldTasks(read)
assert.equal(tasks.length, 3, 'three tasks')
const t1 = tasks.find((task) => task.taskId === 't1')
assert.equal(t1.status, 'ok')
assert.equal(t1.durationMs, 5000)
assert.deepEqual(t1.artifacts, ['F:\\x\\poster.png'])
const t2 = tasks.find((task) => task.taskId === 't2')
assert.equal(t2.status, 'running')
const t3 = tasks.find((task) => task.taskId === 't3')
assert.equal(t3.status, 'failed')
assert.equal(t3.exitCode, 1)

const state = await mod.buildState({ now: 20000 })
assert.ok(state.tasks.length >= 3)
const codex = state.agents.find((agent) => agent.id === 'codex')
assert.equal(codex.todayOk, 1)
const conductor = state.agents.find((agent) => agent.id === 'conductor')
assert.ok(conductor, 'conductor shows up because it has tasks')
assert.equal(conductor.todayFailed, 1)
assert.equal(typeof state.opendesign.ok, 'boolean')

// The host half registers exactly one read-only route and answers with JSON.
let handler = null
const ctx = {
  inject: (deps, callback) => callback({ connection: { fetch: { register: (definition) => { handler = definition } } } }),
}
mod.apply(ctx)
assert.ok(handler, 'apply registered a route')
assert.equal(handler.path, '/api/aiagent-taskboard/state')
assert.deepEqual(handler.methods, ['GET'])
// The /api bridge needs this: without it a GET request throws inside the bridge
// ("Request with GET/HEAD method cannot have body") and the browser sees HTTP 400.
assert.equal(handler.requestBody, 'buffered')
const response = await handler.fetch()
assert.equal(response.status, 200)
const body = await response.json()
assert.ok(Array.isArray(body.tasks) && body.tasks.length >= 3)
assert.ok(Array.isArray(body.agents) && body.agents.length >= 4)
console.log('host route test OK')

await rm(dir, { recursive: true, force: true })