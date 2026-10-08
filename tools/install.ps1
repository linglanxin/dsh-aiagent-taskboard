# install.ps1 - link dsh-aiagent-taskboard into a DSH profile and append its patch row.
#
#   1. a directory junction at <profile>\node_modules\dsh-aiagent-taskboard
#   2. one appended "- insert:" row in <profile>\cordis.patch.yml
#
# It does NOT touch package.json, does NOT run pnpm, and does NOT restart dsh.
# Undo with uninstall.ps1. ASCII-only on purpose.
param(
  [string]$PackageDir = (Split-Path $PSScriptRoot -Parent),
  [string]$DshHome = '',
  [string]$ProfileName = 'desktop'
)
$ErrorActionPreference = 'Continue'
$PluginName = 'dsh-aiagent-taskboard'
$EntryId = 'aiagent-taskboard'
function Say($m) { Write-Host "$(Get-Date -Format 'HH:mm:ss') $m" }
function Fail($m) { Say "FAILED: $m"; exit 2 }
if (-not (Test-Path (Join-Path $PackageDir 'package.json'))) { Fail "no package.json at '$PackageDir'" }
if (-not (Test-Path (Join-Path $PackageDir 'index.js'))) { Fail "no index.js at '$PackageDir'" }
if ($DshHome -eq '') {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME }
  elseif ($env:USERPROFILE) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
  else { Fail 'cannot guess the DSH home; pass -DshHome <dir>' }
}
$Profile = Join-Path (Join-Path $DshHome 'profiles') $ProfileName
$PatchFile = Join-Path $Profile 'cordis.patch.yml'
$ProfileManifest = Join-Path $Profile 'package.json'
$LinkPath = Join-Path $Profile "node_modules\$PluginName"
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = Join-Path $DshHome ".dsh-rollback-$PluginName-$Stamp"
Say "package : $PackageDir"
Say "profile : $Profile"
if (-not (Test-Path $ProfileManifest)) { Fail "no profile at '$Profile'" }
if (-not (Test-Path $PatchFile)) { Fail "no cordis.patch.yml at '$PatchFile'" }
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
Copy-Item -LiteralPath $PatchFile -Destination (Join-Path $Backup 'cordis.patch.yml') -Force
Say "backup  : $Backup"
if (Test-Path -LiteralPath $LinkPath) {
  $item = Get-Item -LiteralPath $LinkPath -Force
  if ($item.LinkType -eq 'Junction' -or $item.LinkType -eq 'SymbolicLink') { Remove-Item -LiteralPath $LinkPath -Force -Recurse }
  else { Fail "$LinkPath already exists and is not a link; remove it by hand" }
}
New-Item -ItemType Junction -Path $LinkPath -Target $PackageDir | Out-Null
Say "linked  : $LinkPath -> $PackageDir"
$lines = @(Get-Content -LiteralPath $PatchFile)
if ($lines -match "id:\s*$EntryId") {
  Say 'patch   : the insert row is already present; left as is'
} else {
  $lines += '- insert:'
  $lines += "    - id: $EntryId"
  $lines += "      name: $PluginName"
  $text = ($lines -join "`r`n") + "`r`n"
  [System.IO.File]::WriteAllText($PatchFile, $text, (New-Object System.Text.UTF8Encoding($false)))
  Say 'patch   : appended the insert row'
}
Say 'done. A profile without dsh.profile.patchReload hot-loads this within seconds - refresh the browser page to load the panel.'
