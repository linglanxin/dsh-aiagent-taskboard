window.__ModuleLoader__.load({ id: "dsh-aiagent-taskboard", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-aiagent-taskboard - browser half.
//
// One sidebar entry plus a main view. It polls GET /api/aiagent-taskboard/state
// (host half) every few seconds and renders a deliberately small board with two
// views over the same data:
//
//   list      - agent chips, one row per task, a row expands into its details.
//   timeline  - swimlanes: one lane per agent, one bar per task placed on a
//               time axis (running tasks stretch to "now").
//
// The timeline layout is a pure function (buildTimeline) so it can be tested
// without a DOM.

const React = require('react')

let runtimeCtx = null

const AGENT_LABEL = { codex: "Codex", claudecode: "Claude Code", dsh: "DSH", opendesign: "Open Design", conductor: "调度器" }
const AGENT_ORDER = ["codex", "claudecode", "dsh", "opendesign", "conductor"]
const COLOR = { running: "#2563eb", ok: "#16a34a", failed: "#dc2626", idle: "#9ca3af" }
const DAY_MS = 24 * 60 * 60 * 1000
const GUTTER = "94px"
const TICKS = 5
const WINDOWS = [
  { ms: 6 * 60 * 60 * 1000, label: "window6" },
  { ms: DAY_MS, label: "window24" },
  { ms: 7 * DAY_MS, label: "window7" },
]

const TXT = {
  zh: {
    entry: "任务台",
    title: "任务台",
    lead: "谁在跑、跑到哪、出了什么产物。",
    refresh: "刷新",
    loading: "读取中…",
    empty: "还没有任务记录。用 codex / claude / conductor 跑一次任务就会出现。",
    sessions: "最近会话",
    opendesign: "Open Design",
    offline: "未运行",
    running: "运行中",
    todayOk: "今日成功",
    todayFail: "失败",
    dir: "目录",
    exit: "退出码",
    note: "结果",
    artifacts: "产物",
    updated: "更新于",
    viewList: "列表",
    viewTimeline: "时间线",
    window6: "6 小时",
    window24: "24 小时",
    window7: "7 天",
    noTasks: "这段时间没有任务，换个范围看看。",
    now: "现在",
    ok: "成功",
  },
  en: {
    entry: "Taskboard",
    title: "Taskboard",
    lead: "Who is running what, and what came out of it.",
    refresh: "Refresh",
    loading: "Loading…",
    empty: "No tasks yet. Run something through codex / claude / conductor.",
    sessions: "Recent sessions",
    opendesign: "Open Design",
    offline: "offline",
    running: "running",
    todayOk: "ok today",
    todayFail: "failed",
    dir: "directory",
    exit: "exit",
    note: "result",
    artifacts: "artifacts",
    updated: "updated",
    viewList: "List",
    viewTimeline: "Timeline",
    window6: "6h",
    window24: "24h",
    window7: "7d",
    noTasks: "Nothing ran in this window - try a wider range.",
    now: "now",
    ok: "ok",
  },
}

function language() {
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || []
  return String(list[0] || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en"
}
function t(key) { const dictionary = TXT[language()] || TXT.en; return dictionary[key] !== undefined ? dictionary[key] : key }

function basename(value) {
  const text = String(value || "")
  const parts = text.split(/[\\/]/)
  return parts[parts.length - 1] || text
}
function clock(ms) {
  if (!ms) return "-"
  const date = new Date(ms)
  const pad = (v) => String(v).padStart(2, "0")
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds())
}
function ago(ms) {
  if (!ms) return "-"
  const diff = Date.now() - ms
  if (diff < 60000) return Math.max(0, Math.round(diff / 1000)) + "s"
  if (diff < 3600000) return Math.round(diff / 60000) + "m"
  if (diff < 86400000) return Math.round(diff / 3600000) + "h"
  return Math.round(diff / 86400000) + "d"
}
function duration(ms) {
  if (ms === null || ms === undefined || ms < 0) return "-"
  if (ms < 60000) return Math.round(ms / 1000) + "s"
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  if (minutes < 60) return minutes + "m" + (seconds ? " " + seconds + "s" : "")
  return Math.floor(minutes / 60) + "h" + (minutes % 60) + "m"
}
function taskLabel(task) {
  return task && task.label && task.label !== task.taskId ? task.label : basename(task && task.dir) || (task && task.taskId) || "?"
}

/**
 * Lay tasks out as swimlanes over the window [now - windowMs, now].
 *
 * Each task becomes a bar with left/width as a fraction of the window; a lane
 * is one agent, and overlapping bars in a lane are packed into extra rows so
 * they never hide each other. Tasks without a start time, or completely outside
 * the window, are dropped.
 */
function buildTimeline(tasks, options) {
  const now = Number(options && options.now) || Date.now()
  const windowMs = Number(options && options.windowMs) > 0 ? Number(options.windowMs) : DAY_MS
  const from = now - windowMs
  const items = []
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const start = Number(task && task.startedAt) || 0
    if (start <= 0) continue
    const running = task.status === "running" && (task.endedAt === null || task.endedAt === undefined)
    const rawEnd = Number(task.endedAt) || (running ? now : start)
    const end = Math.max(rawEnd, start)
    if (end < from || start > now) continue
    const visibleStart = Math.max(start, from)
    const visibleEnd = Math.min(Math.max(end, visibleStart), now)
    items.push({
      task,
      start,
      end,
      running,
      left: (visibleStart - from) / windowMs,
      width: Math.max(visibleEnd - visibleStart, 0) / windowMs,
    })
  }

  const order = []
  for (const item of items) {
    const agent = item.task.agent || "unknown"
    if (order.indexOf(agent) < 0) order.push(agent)
  }
  order.sort(function (a, b) {
    const ia = AGENT_ORDER.indexOf(a); const ib = AGENT_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : a > b ? 1 : 0)
  })

  const lanes = order.map(function (agent) {
    const own = items.filter(function (item) { return (item.task.agent || "unknown") === agent }).sort(function (a, b) { return a.start - b.start })
    const rows = []
    for (const item of own) {
      let row = null
      for (const candidate of rows) {
        if (candidate[candidate.length - 1].end <= item.start) { row = candidate; break }
      }
      if (row === null) { row = []; rows.push(row) }
      row.push(item)
    }
    return { agent, label: AGENT_LABEL[agent] || agent, rows, count: own.length }
  })

  const ticks = []
  for (let index = 0; index < TICKS; index += 1) {
    ticks.push({ at: from + (windowMs * index) / (TICKS - 1), left: index / (TICKS - 1), now: index === TICKS - 1 })
  }
  return { from, to: now, windowMs, ticks, lanes, count: items.length }
}

const S = {
  wrap: { display: "flex", flexDirection: "column", gap: "12px", padding: "20px 22px", maxWidth: "760px", margin: "0 auto", width: "100%", boxSizing: "border-box", font: "inherit", color: "inherit" },
  head: { display: "flex", alignItems: "baseline", gap: "10px" },
  title: { margin: 0, fontSize: "17px", fontWeight: 600 },
  muted: { margin: 0, fontSize: "11px", opacity: 0.55 },
  ghost: { marginLeft: "auto", height: "26px", padding: "0 10px", borderRadius: "6px", border: "1px solid var(--dsh-color-border, rgba(128,128,128,.3))", background: "transparent", color: "inherit", fontSize: "12px", cursor: "pointer" },
  chips: { display: "flex", flexWrap: "wrap", gap: "8px" },
  chip: { display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderRadius: "999px", border: "1px solid var(--dsh-color-border, rgba(128,128,128,.28))", fontSize: "12px" },
  dot: { width: "7px", height: "7px", borderRadius: "999px", display: "inline-block", flex: "0 0 auto" },
  controls: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  segments: { display: "inline-flex", border: "1px solid var(--dsh-color-border, rgba(128,128,128,.28))", borderRadius: "7px", overflow: "hidden" },
  segment: { padding: "4px 10px", border: "none", borderRight: "1px solid var(--dsh-color-border, rgba(128,128,128,.18))", background: "transparent", color: "inherit", fontSize: "12px", cursor: "pointer" },
  segmentOn: { background: "var(--dsh-color-border, rgba(128,128,128,.22))", fontWeight: 600 },
  list: { display: "flex", flexDirection: "column", border: "1px solid var(--dsh-color-border, rgba(128,128,128,.24))", borderRadius: "10px", overflow: "hidden" },
  row: { display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px", borderTop: "1px solid var(--dsh-color-border, rgba(128,128,128,.16))", fontSize: "12px", cursor: "pointer" },
  rowFirst: { borderTop: "none" },
  name: { flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tag: { opacity: 0.5, fontSize: "11px" },
  num: { opacity: 0.6, fontSize: "11px", fontVariantNumeric: "tabular-nums" },
  detail: { padding: "4px 12px 12px 30px", fontSize: "11px", lineHeight: "1.7", borderTop: "1px solid var(--dsh-color-border, rgba(128,128,128,.16))", opacity: 0.85 },
  mono: { fontFamily: "ui-monospace, Consolas, monospace", wordBreak: "break-all" },
  section: { marginTop: "10px" },
  err: { margin: 0, fontSize: "12px", color: "var(--dsh-color-danger, #d92c20)" },
  timeline: { display: "flex", flexDirection: "column", gap: "2px", border: "1px solid var(--dsh-color-border, rgba(128,128,128,.24))", borderRadius: "10px", padding: "10px 12px 12px", boxSizing: "border-box" },
  axisRow: { display: "flex", alignItems: "center", gap: "8px" },
  gutter: { flex: "0 0 " + GUTTER, maxWidth: GUTTER, display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", overflow: "hidden", whiteSpace: "nowrap", opacity: 0.75 },
  axis: { position: "relative", flex: "1 1 auto", height: "14px" },
  tickLabel: { position: "absolute", top: 0, fontSize: "10px", opacity: 0.55, whiteSpace: "nowrap" },
  tickNow: { opacity: 0.9, fontWeight: 600 },
  lane: { display: "flex", alignItems: "center", gap: "8px" },
  laneLabel: { flex: "0 0 " + GUTTER, maxWidth: GUTTER, display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", overflow: "hidden", whiteSpace: "nowrap" },
  track: { position: "relative", flex: "1 1 auto", borderRight: "1px dashed var(--dsh-color-border, rgba(128,128,128,.45))", borderRadius: "4px", background: "var(--dsh-color-surface, rgba(128,128,128,.06))" },
  barRow: { position: "absolute", left: 0, right: 0, height: "14px" },
  bar: { position: "absolute", top: "1px", height: "12px", borderRadius: "3px", boxSizing: "border-box", padding: "0 5px", fontSize: "10px", lineHeight: "12px", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" },
  legend: { display: "flex", alignItems: "center", gap: "12px", fontSize: "11px", opacity: 0.7, marginTop: "4px" },
  legendItem: { display: "flex", alignItems: "center", gap: "5px" },
  grid: { position: "absolute", top: 0, bottom: 0, width: "1px", background: "var(--dsh-color-border, rgba(128,128,128,.2))", pointerEvents: "none" },
}

async function loadState() {
  const response = await fetch("/api/aiagent-taskboard/state", { headers: { Accept: "application/json" } })
  if (!response.ok) {
    let body = ""
    try { body = (await response.text()).slice(0, 120) } catch (cause) { /* no body to show */ }
    const hint = response.status === 400 ? "（宿主半未重载，重启 DSH 即可）" : ""
    throw new Error("HTTP " + response.status + hint + (body ? " · " + body : ""))
  }
  return response.json()
}

function statusColor(status) { return COLOR[status] || COLOR.idle }

function Icon() {
  return React.createElement("svg", { viewBox: "0 0 16 16", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", "aria-hidden": "true" },
    React.createElement("path", { d: "M2.5 4.5h11" }),
    React.createElement("path", { d: "M2.5 8h7" }),
    React.createElement("path", { d: "M2.5 11.5h9" }),
  )
}

function segments(key, options, value, onChange) {
  return React.createElement("div", { style: S.segments, key },
    options.map(function (option) {
      return React.createElement("button", {
        key: option.id,
        type: "button",
        style: Object.assign({}, S.segment, option.id === value ? S.segmentOn : {}),
        onClick: function () { onChange(option.id) },
      }, option.label)
    }),
  )
}

/** The expanded detail block, shared by the list rows and the timeline. */
function detailNode(task) {
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : []
  return React.createElement("div", { style: S.detail },
    task.dir ? React.createElement("div", null, t("dir") + ": ", React.createElement("span", { style: S.mono }, task.dir)) : null,
    task.exitCode === null || task.exitCode === undefined ? null : React.createElement("div", null, t("exit") + ": " + task.exitCode),
    task.note ? React.createElement("div", null, t("note") + ": " + task.note) : null,
    artifacts.length > 0 ? React.createElement("div", null, t("artifacts") + ": ", React.createElement("span", { style: S.mono }, artifacts.join("  "))) : null,
  )
}

/** One bar on a lane: position and width are fractions of the window. */
function TimelineBar(props) {
  const item = props.item
  const task = item.task
  const label = taskLabel(task)
  const title = [label, AGENT_LABEL[task.agent] || task.agent, duration(task.durationMs), clock(item.start) + " → " + (item.running ? t("now") : clock(item.end))].join(" · ")
  const width = Math.max(item.width * 100, 0.7)
  return React.createElement("div", {
    style: Object.assign({}, S.bar, {
      left: (item.left * 100) + "%",
      width: width + "%",
      background: statusColor(task.status),
      boxShadow: props.selected ? "0 0 0 2px var(--dsh-color-surface, #fff) inset" : "none",
    }),
    title,
    onClick: props.onSelect,
  }, label)
}

function Timeline(props) {
  const tasks = Array.isArray(props.tasks) ? props.tasks : []
  const now = props.now || Date.now()
  const windowMs = props.windowMs || DAY_MS
  const selected = props.selected || null
  const onSelect = typeof props.onSelect === "function" ? props.onSelect : function () {}
  const model = buildTimeline(tasks, { now, windowMs })
  const selectedTask = selected === null ? null : tasks.filter(function (task) { return task.taskId === selected })[0] || null

  if (model.count === 0) {
    return React.createElement("div", { style: S.timeline },
      React.createElement("p", { style: S.muted }, t("noTasks")),
    )
  }

  const children = [
    React.createElement("div", { style: S.axisRow, key: "axis" },
      React.createElement("span", { style: { flex: "0 0 " + GUTTER } }),
      React.createElement("div", { style: S.axis }, model.ticks.map(function (tick) {
        const shift = tick.left === 0 ? "0" : tick.left === 1 ? "-100%" : "-50%"
        return React.createElement("span", {
          key: tick.at,
          style: Object.assign({}, S.tickLabel, { left: (tick.left * 100) + "%", transform: "translateX(" + shift + ")" }, tick.now ? S.tickNow : {}),
        }, (tick.now ? t("now") + " " : "") + clock(tick.at))
      })),
    ),
  ]

  for (const lane of model.lanes) {
    children.push(React.createElement("div", { style: S.lane, key: lane.agent },
      React.createElement("span", { style: S.laneLabel, title: lane.label },
        React.createElement("span", { style: Object.assign({}, S.dot, { background: lane.rows.length > 0 ? statusColor(lane.rows[0][0].task.status) : COLOR.idle }) }),
        React.createElement("span", { style: S.name }, lane.label),
        React.createElement("span", { style: S.num }, String(lane.count)),
      ),
      React.createElement("div", { style: Object.assign({}, S.track, { height: (lane.rows.length * 15 + 5) + "px" }) },
        model.ticks.slice(0, TICKS - 1).map(function (tick) {
          return React.createElement("div", { key: "grid" + tick.left, style: Object.assign({}, S.grid, { left: (tick.left * 100) + "%" }) })
        }),
        lane.rows.map(function (row, rowIndex) {
          return React.createElement("div", { key: "row" + rowIndex, style: Object.assign({}, S.barRow, { top: (rowIndex * 15 + 2) + "px" }) },
            row.map(function (item) {
              return React.createElement(TimelineBar, {
                key: item.task.taskId,
                item,
                selected: selected === item.task.taskId,
                onSelect: function () { onSelect(selected === item.task.taskId ? null : item.task.taskId) },
              })
            }),
          )
        }),
      ),
    ))
  }

  children.push(React.createElement("div", { style: S.legend, key: "legend" },
    [["running", t("running")], ["ok", t("ok")], ["failed", t("todayFail")]].map(function (pair) {
      return React.createElement("span", { key: pair[0], style: S.legendItem },
        React.createElement("span", { style: Object.assign({}, S.dot, { background: COLOR[pair[0]] }) }),
        React.createElement("span", null, pair[1]),
      )
    }),
  ))

  if (selectedTask !== null) children.push(React.createElement("div", { key: "sel" }, detailNode(selectedTask)))

  return React.createElement("div", { style: S.timeline }, children)
}

function TaskboardPanel() {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [open, setOpen] = React.useState(null)
  const [view, setView] = React.useState("list")
  const [windowMs, setWindowMs] = React.useState(DAY_MS)

  const refresh = React.useCallback(function () {
    Promise.resolve().then(loadState).then(function (next) { setData(next); setError(null) }).catch(function (cause) { setError(cause && cause.message ? cause.message : String(cause)) })
  }, [])

  React.useEffect(function () {
    refresh()
    const timer = setInterval(refresh, 5000)
    return function () { clearInterval(timer) }
  }, [refresh])

  const agents = data && Array.isArray(data.agents) ? data.agents : []
  const tasks = data && Array.isArray(data.tasks) ? data.tasks : []
  const sessions = data && Array.isArray(data.sessions) ? data.sessions : []
  const od = data && data.opendesign ? data.opendesign : { ok: false }
  const now = data && data.generatedAt ? data.generatedAt : Date.now()

  const children = [
    React.createElement("div", { style: S.head, key: "head" },
      React.createElement("h1", { style: S.title }, t("title")),
      React.createElement("p", { style: S.muted }, t("lead")),
      React.createElement("button", { style: S.ghost, type: "button", onClick: refresh, key: "r" }, t("refresh")),
    ),
    React.createElement("div", { style: S.chips, key: "chips" },
      agents.map(function (agent) {
        const color = agent.running > 0 ? COLOR.running : (agent.todayFailed > 0 ? COLOR.failed : (agent.todayOk > 0 ? COLOR.ok : COLOR.idle))
        return React.createElement("span", { style: S.chip, key: agent.id, title: agent.lastAt ? ago(agent.lastAt) : "" },
          React.createElement("span", { style: Object.assign({}, S.dot, { background: color }) }),
          React.createElement("span", null, AGENT_LABEL[agent.id] || agent.label || agent.id),
          agent.running > 0 ? React.createElement("span", { style: S.num }, agent.running + " " + t("running")) : null,
          agent.running === 0 && (agent.todayOk || agent.todayFailed) ? React.createElement("span", { style: S.num }, (agent.todayOk || 0) + "/" + (agent.todayFailed || 0)) : null,
        )
      }),
      React.createElement("span", { style: S.chip },
        React.createElement("span", { style: Object.assign({}, S.dot, { background: od.ok ? COLOR.ok : COLOR.idle }) }),
        React.createElement("span", null, t("opendesign")),
        React.createElement("span", { style: S.num }, od.ok ? ("127.0.0.1:" + od.port + (od.version ? " · " + od.version : "")) : t("offline")),
      ),
    ),
    React.createElement("div", { style: S.controls, key: "controls" },
      segments("view", [{ id: "list", label: t("viewList") }, { id: "timeline", label: t("viewTimeline") }], view, setView),
      view === "timeline" ? segments("window", WINDOWS.map(function (entry) {
        return { id: String(entry.ms), label: t(entry.label) }
      }), String(windowMs), function (id) { setWindowMs(Number(id)) }) : null,
    ),
    error !== null ? React.createElement("p", { style: S.err, key: "err", role: "alert" }, error) : null,
    tasks.length === 0
      ? React.createElement("p", { style: S.muted, key: "empty" }, data === null ? t("loading") : t("empty"))
      : view === "timeline"
        ? React.createElement(Timeline, { key: "timeline", tasks, now, windowMs, selected: open, onSelect: setOpen })
        : React.createElement("div", { style: S.list, key: "list" }, tasks.map(function (task, index) {
            const expanded = open === task.taskId
            const rows = [
              React.createElement("div", {
                key: task.taskId,
                style: Object.assign({}, S.row, index === 0 ? S.rowFirst : {}),
                onClick: function () { setOpen(expanded ? null : task.taskId) },
              },
                React.createElement("span", { style: Object.assign({}, S.dot, { background: statusColor(task.status) }) }),
                React.createElement("span", { style: S.name }, taskLabel(task)),
                React.createElement("span", { style: S.tag }, AGENT_LABEL[task.agent] || task.agent),
                React.createElement("span", { style: S.num }, duration(task.durationMs)),
                React.createElement("span", { style: S.num }, ago(task.startedAt)),
              ),
            ]
            if (expanded) rows.push(React.createElement("div", { key: task.taskId + "-d" }, detailNode(task)))
            return React.createElement("div", { key: task.taskId + "-wrap" }, rows)
          })),
    sessions.length > 0 ? React.createElement("div", { style: S.section, key: "sessions" },
      React.createElement("p", { style: S.muted }, t("sessions")),
      React.createElement("div", { style: S.chips }, sessions.slice(0, 6).map(function (session) {
        return React.createElement("span", { style: S.chip, key: session.path, title: session.path },
          React.createElement("span", null, AGENT_LABEL[session.agent] || session.agent),
          React.createElement("span", { style: S.num }, basename(session.path)),
          React.createElement("span", { style: S.num }, ago(session.mtimeMs)),
        )
      })),
    ) : null,
    data !== null ? React.createElement("p", { style: S.muted, key: "foot" }, t("updated") + " " + clock(data.generatedAt)) : null,
  ]

  return React.createElement("section", { style: S.wrap }, children)
}

function apply(ctx) {
  runtimeCtx = ctx
  ctx.slots.inject("sidebar.panellist", function () {
    return ctx.slots.register(
      { name: "sidebar.panellist", id: "dsh-aiagent-taskboard", order: 12, label: function () { return t("entry") } },
      Icon,
    )
  })
  ctx.slots.inject("main", function () {
    return ctx.slots.register({ name: "main", key: "dsh-aiagent-taskboard" }, TaskboardPanel)
  })
}

const inject = ["slots"]

exports.apply = apply
exports.inject = inject
exports.TaskboardPanel = TaskboardPanel
exports.Timeline = Timeline
exports.buildTimeline = buildTimeline

return module.exports
}});
