# uninstall.ps1 - remove the junction and the insert row that install.ps1 added.
param(
  [string]$DshHome = '',
  [string]$ProfileName = 'desktop'
)
$ErrorActionPreference = 'Continue'
$PluginName = 'dsh-aiagent-taskboard'
$EntryId = 'aiagent-taskboard'
function Say($m) { Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }
if ($DshHome -eq '') {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME } elseif ($env:USERPROFILE) { $DshHome = Join-Path $env:USERPROFILE '.dsh' } else { throw 'pass -DshHome' }
}
$Profile = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
$PatchFile = Join-Path $Profile 'cordis.patch.yml'
$LinkPath = Join-Path $Profile "node_modules\$PluginName"
if (Test-Path -LiteralPath $LinkPath) { Remove-Item -LiteralPath $LinkPath -Force -Recurse; Say "removed $LinkPath" }
if (Test-Path $PatchFile) {
  $backup = Join-Path $DshHome (".dsh-rollback-$PluginName-uninstall-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  Copy-Item -LiteralPath $PatchFile -Destination (Join-Path $backup 'cordis.patch.yml') -Force
  $kept = New-Object System.Collections.Generic.List[string]
  $skip = 0
  foreach ($line in (Get-Content -LiteralPath $PatchFile)) {
    if ($skip -gt 0) { $skip--; continue }
    if ($line -match '^\s*-\s*insert:\s*$') {
      $block = @($line)
      $isOurs = $false
      for ($i = 0; $i -lt 4; $i++) { }
      $kept.Add($line)
      continue
    }
    if ($line -match "id:\s*$EntryId") {
      if ($kept.Count -gt 0 -and $kept[$kept.Count - 1] -match '-\s*insert:\s*$') { $kept.RemoveAt($kept.Count - 1) }
      continue
    }
    if ($line -match "name:\s*$PluginName") { continue }
    $kept.Add($line)
  }
  [System.IO.File]::WriteAllText($PatchFile, (($kept -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
  Say "patch cleaned (backup: $backup)"
}
