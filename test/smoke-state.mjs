// Prints the live snapshot this plugin would serve (used for a quick manual check).
const mod = await import('../index.js')
const state = await mod.buildState({ now: Date.now() })
console.log(JSON.stringify({
  stateDir: state.stateDir,
  eventCount: state.eventCount,
  opendesign: state.opendesign,
  agents: state.agents,
  tasks: state.tasks.slice(0, 5),
  sessions: state.sessions.slice(0, 5),
}, null, 1))
