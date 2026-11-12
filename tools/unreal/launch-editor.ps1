# Launches Unreal Editor on the BODYCAM visual-dev project with the Unreal MCP server started.
# Resolution order (no machine-specific paths are stored in this file):
#   project: $env:BODYCAM_UE_PROJECT, else ..\..\..\BodycamVisDev\BodycamVisDev.uproject (a sibling folder of this repo)
#   engine:  $env:BODYCAM_UE_ROOT, else the build registered for the project's EngineAssociation
#            (HKCU:\SOFTWARE\Epic Games\Unreal Engine\Builds, or HKLM for launcher installs)
param([int]$Port = 8000)

$project = if ($env:BODYCAM_UE_PROJECT) { $env:BODYCAM_UE_PROJECT } else { Join-Path $PSScriptRoot '..\..\..\BodycamVisDev\BodycamVisDev.uproject' }
if (-not (Test-Path $project)) { throw "Project not found at $project (set BODYCAM_UE_PROJECT)" }
$project = (Resolve-Path $project).Path

$ueRoot = $env:BODYCAM_UE_ROOT
if (-not $ueRoot) {
  $assoc = (Get-Content $project -Raw | ConvertFrom-Json).EngineAssociation
  $ueRoot = (Get-ItemProperty 'HKCU:\SOFTWARE\Epic Games\Unreal Engine\Builds' -ErrorAction SilentlyContinue).$assoc
  if (-not $ueRoot) { $ueRoot = (Get-ItemProperty "HKLM:\SOFTWARE\EpicGames\Unreal Engine\$assoc" -ErrorAction SilentlyContinue).InstalledDirectory }
  if (-not $ueRoot) { throw "No engine registered for EngineAssociation '$assoc' (set BODYCAM_UE_ROOT)" }
}
$editor = Join-Path $ueRoot 'Engine\Binaries\Win64\UnrealEditor.exe'
if (-not (Test-Path $editor)) { throw "UnrealEditor.exe not found at $editor (set BODYCAM_UE_ROOT)" }

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Write-Warning "Port $Port already has a listener (PID $($busy[0].OwningProcess)). Is an editor already running?" }

Write-Host "Starting $editor"
Write-Host "  project: $project"
Write-Host "  MCP:     http://127.0.0.1:$Port/mcp"
if ($env:BODYCAM_DRY_RUN) { Write-Host '  (dry run: not starting)'; return }
Start-Process -FilePath $editor -ArgumentList @("`"$project`"", '-ModelContextProtocolStartServer', "-ModelContextProtocolPort=$Port")
