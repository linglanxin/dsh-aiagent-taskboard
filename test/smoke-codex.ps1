$ErrorActionPreference = 'Continue'
$node = 'C:\Users\h''s\AppData\Local\OpenDesign\toolchains\dsh\node-v24.19.0-win-x64\node.exe'
Write-Output '=== 1) 跑一个最简单的真实任务：codex.cmd exec "reply with exactly OK" ==='
$env:AIAGENT_SESSION = 'taskboard-test'
$sw = [Diagnostics.Stopwatch]::StartNew()
$out = & 'F:\aiagent\bin\codex.cmd' exec "reply with exactly OK" 2>&1
$code = $LASTEXITCODE
$sw.Stop()
Write-Output ('  exit=' + $code + '  耗时=' + [int]$sw.Elapsed.TotalSeconds + 's')
foreach ($l in @($out | ForEach-Object { $_.ToString() })) { Write-Output ('  | ' + $l.Substring(0, [Math]::Min(150, $l.Length))) }
Start-Sleep -Seconds 2
Write-Output ''
Write-Output '=== 2) 事件日志（面板读的就是这个） ==='
Get-Content -LiteralPath 'F:\aiagent\.state\events.jsonl' -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ('  ' + $_) }
Write-Output ''
Write-Output '=== 3) 插件宿主实际会返回的快照 ==='
$json = & $node 'F:\aiagent\dsh-plugin\aiagent-taskboard\test\smoke-state.mjs' 2>&1 | Out-String
$state = $null
try { $state = $json | ConvertFrom-Json } catch { Write-Output ('  parse failed: ' + $json.Substring(0, [Math]::Min(200, $json.Length))) }
if ($state) {
  Write-Output ('  Open Design: ' + ($state.opendesign | ConvertTo-Json -Compress))
  foreach ($a in $state.agents) { Write-Output ('  agent ' + $a.id + '  running=' + $a.running + '  todayOk=' + $a.todayOk + '  todayFailed=' + $a.todayFailed) }
  foreach ($t in $state.tasks) {
    Write-Output ('  task  ' + $t.agent + '  ' + $t.status + '  ' + [math]::Round($t.durationMs/1000,1) + 's  ' + $t.dir)
    if ($t.artifacts.Count -gt 0) { Write-Output ('        artifacts: ' + ($t.artifacts -join ', ')) }
  }
  Write-Output ('  sessions: ' + (($state.sessions | ForEach-Object { $_.agent + '/' + $_.name }) -join ', '))
}
