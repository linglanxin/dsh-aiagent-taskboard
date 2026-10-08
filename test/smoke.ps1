$ErrorActionPreference = 'Continue'
$node = "C:\Users\h's\AppData\Local\OpenDesign\toolchains\dsh\node-v24.19.0-win-x64\node.exe"
Write-Output '--- aiagent-log.ps1 round trip ---'
$id = & 'F:\aiagent\bin\aiagent-log.ps1' -Agent codex -Action start -Dir 'F:\aiagent\codex\_logdemo'
Write-Output ('  start taskId=' + $id)
& 'F:\aiagent\bin\aiagent-log.ps1' -Agent codex -Action artifact -TaskId $id -Path 'F:\aiagent\codex\_logdemo\poster.png'
& 'F:\aiagent\bin\aiagent-log.ps1' -Agent codex -Action end -Dir 'F:\aiagent\codex\_logdemo' -ExitCode 0
Write-Output '  end resolved by directory (no -TaskId)'
Get-Content -LiteralPath 'F:\aiagent\.state\events.jsonl' -Tail 3 | ForEach-Object { Write-Output ('  ' + $_) }
Write-Output '--- live snapshot ---'
& $node 'F:\aiagent\dsh-plugin\aiagent-taskboard\test\smoke-state.mjs' 2>&1 | Select-Object -First 80 | ForEach-Object { Write-Output ('  ' + $_) }
