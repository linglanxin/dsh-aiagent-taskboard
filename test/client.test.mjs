// Offline client test: the bundle registers a sidebar entry and a main panel,
// the panel renders, and the swimlane timeline lays tasks out correctly.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
let captured = null
const window = { __ModuleLoader__: { load: (definition) => { captured = definition } } }
new Function('window', source)(window)
assert.equal(captured.id, 'dsh-aiagent-taskboard')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}
const bundle = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
assert.equal(typeof bundle.apply, 'function')
assert.deepEqual(bundle.inject, ['slots'])

const registrations = []
const ctx = { slots: { inject: (name, fn) => fn(), register: (definition, component) => { registrations.push({ definition, component }); return () => {} } } }
bundle.apply(ctx)
assert.equal(registrations.length, 2, 'sidebar entry + main panel')
assert.equal(registrations[0].definition.id, 'dsh-aiagent-taskboard')
const main = registrations.find((entry) => entry.definition.name === 'main')
assert.equal(main.definition.key, 'dsh-aiagent-taskboard')

// --- the panel itself renders, and carries the list/timeline switch ---------
globalThis.fetch = async () => ({ ok: true, json: async () => ({ generatedAt: 1, agents: [], tasks: [], sessions: [], opendesign: { ok: false } }) })
const tree = main.component()
assert.equal(tree.type, 'section')
const panelText = JSON.stringify(tree)
assert.ok(panelText.includes('Timeline') || panelText.includes('时间线'), 'the view switch is rendered')

// --- buildTimeline: one lane per agent, overlapping bars get their own row --
const HOUR = 60 * 60 * 1000
const now = 10000000
const tasks = [
  { taskId: 'a', agent: 'codex', status: 'ok', label: 'a', dir: 'F:\\aiagent\\codex\\one', startedAt: now - 60000, endedAt: now - 50000, durationMs: 10000, exitCode: 0 },
  { taskId: 'b', agent: 'codex', status: 'failed', label: 'b', startedAt: now - 55000, endedAt: now - 40000, durationMs: 15000, exitCode: 1 },
  { taskId: 'c', agent: 'codex', status: 'running', label: 'c', startedAt: now - 30000, endedAt: null, durationMs: null },
  { taskId: 'd', agent: 'claudecode', status: 'ok', label: 'd', startedAt: now - 9 * HOUR, endedAt: now - 9 * HOUR + 1000 },
  { taskId: 'e', agent: 'dsh', status: 'ok', label: 'e', startedAt: 0, endedAt: null },
]
const model = bundle.buildTimeline(tasks, { now, windowMs: 6 * HOUR })
assert.equal(model.from, now - 6 * HOUR)
assert.equal(model.to, now)
assert.equal(model.count, 3, 'only tasks overlapping the window')
assert.equal(model.lanes.length, 1, 'only codex has tasks in this window')
assert.deepEqual(model.lanes[0].rows.map((row) => row.map((item) => item.task.taskId)), [['a', 'c'], ['b']], 'c fits next to a, b overlaps and moves to row 2')
assert.equal(model.ticks.length, 5)
assert.equal(model.ticks[4].now, true)
assert.equal(model.ticks[4].left, 1)
const running = model.lanes[0].rows[0][1]
assert.equal(running.running, true)
assert.equal(running.end, now, 'a running task stretches to now')
assert.ok(running.width > 0 && running.width < 0.01)
const first = model.lanes[0].rows[0][0]
assert.equal(first.left, (6 * HOUR - 60000) / (6 * HOUR))

// --- the timeline renders lanes, bars and the selected detail ---------------
const rendered = bundle.Timeline({ tasks, now, windowMs: 6 * HOUR, selected: 'b', onSelect: () => {} })
assert.equal(rendered.type, 'div')
const timelineText = JSON.stringify(rendered)
assert.ok(timelineText.includes('Codex'), 'lane label')
assert.ok(timelineText.includes('F:\\\\aiagent\\\\codex\\\\one'), 'selected task detail shows its directory')
assert.ok(timelineText.includes('"width"'), 'bars carry a width')
const empty = bundle.Timeline({ tasks: [], now, windowMs: 6 * HOUR, selected: null, onSelect: () => {} })
assert.ok(JSON.stringify(empty).length > 0, 'empty window still renders a hint')

await new Promise((resolve) => setTimeout(resolve, 20))
console.log('client.test.mjs OK')
