$ErrorActionPreference = 'Continue'
$env:AIAGENT_SESSION = 'taskboard-demo3'
Write-Output '--- run claude.cmd ---'
$out = & 'F:\aiagent\bin\claude.cmd' -p 'reply with exactly OK' 2>&1
Write-Output ('  exit=' + $LASTEXITCODE)
foreach ($l in @($out | ForEach-Object { $_.ToString() })) { Write-Output ('    | ' + $l.Substring(0, [Math]::Min(140, $l.Length))) }
Start-Sleep -Seconds 2
Write-Output '--- events tail ---'
Get-Content -LiteralPath 'F:\aiagent\.state\events.jsonl' -Tail 3 | ForEach-Object { Write-Output ('  ' + $_) }
