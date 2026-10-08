$ErrorActionPreference = 'Continue'
$node = 'C:\Users\h''s\AppData\Local\OpenDesign\toolchains\dsh\node-v24.19.0-win-x64\node.exe'
Write-Output '--- real tiny run through claude.cmd (validates the logging hook) ---'
$env:AIAGENT_SESSION = 'taskboard-demo'
$out = & 'F:\aiagent\bin\claude.cmd' -p 'reply with exactly OK' 2>&1 | Out-String
Write-Output ('  exit=' + $LASTEXITCODE)
$flat = ($out -replace '\s+', ' ').Trim()
if ($flat.Length -gt 200) { $flat = $flat.Substring(0, 200) }
Write-Output ('  output: ' + $flat)
Write-Output '--- events.jsonl ---'
if (Test-Path 'F:\aiagent\.state\events.jsonl') { Get-Content -LiteralPath 'F:\aiagent\.state\events.jsonl' | ForEach-Object { Write-Output ('  ' + $_) } } else { Write-Output '  (no events)' }
Write-Output '--- snapshot (tasks/sessions/agents) ---'
$json = & $node 'F:\aiagent\dsh-plugin\aiagent-taskboard\test\smoke-state.mjs' 2>&1 | Out-String
$state = $null
try { $state = $json | ConvertFrom-Json } catch { Write-Output ('  parse skipped: ' + $json.Substring(0, [Math]::Min(300, $json.Length))) }
if ($state) {
  Write-Output ('  opendesign: ' + ($state.opendesign | ConvertTo-Json -Compress))
  foreach ($t in $state.tasks) { Write-Output ('  task: ' + $t.agent + ' | ' + $t.status + ' | ' + $t.durationMs + 'ms | ' + $t.dir) }
  foreach ($a in $state.agents) { Write-Output ('  agent: ' + $a.id + ' running=' + $a.running + ' ok=' + $a.todayOk + ' failed=' + $a.todayFailed) }
}
