param([Parameter(Mandatory=$true)][string]$Tool, [int]$Ranks = 1, [Parameter(ValueFromRemainingArguments=$true)][string[]]$ToolArgs)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$foamRoot = Join-Path $projectRoot '.artifacts/cfd-tools/OpenFOAM/msys64/home/ofuser/OpenFOAM/OpenFOAM-v2506'
$foamBin = Join-Path $foamRoot 'platforms/win64MingwDPInt32Opt/bin'
$env:WM_PROJECT = 'OpenFOAM'
$env:WM_PROJECT_DIR = $foamRoot
$env:WM_PROJECT_VERSION = 'v2506'
$env:FOAM_ETC = Join-Path $foamRoot 'etc'
$env:FOAM_LIBBIN = $foamBin
$env:FOAM_APPBIN = $foamBin
$env:FOAM_SIGFPE = 'true'
$env:PATH = "$foamBin;$(Join-Path $projectRoot '.artifacts/cfd-tools/mpi-native');$env:PATH"
if ($Ranks -gt 1) {
    $parallelBin = Join-Path $projectRoot '.artifacts/cfd-tools/parallel'
    New-Item -ItemType Directory -Force $parallelBin | Out-Null
    $parallelExe = Join-Path $parallelBin ($Tool + '.exe')
    if (-not (Test-Path -LiteralPath $parallelExe)) { Copy-Item -LiteralPath (Join-Path $foamBin ($Tool + '.exe')) -Destination $parallelExe }
    $parallelDll = Join-Path $parallelBin 'libPstream.dll'
    if (-not (Test-Path -LiteralPath $parallelDll)) { Copy-Item -LiteralPath (Join-Path $foamBin 'libPstream.dll-msmpi') -Destination $parallelDll }
    & (Join-Path $projectRoot '.artifacts/cfd-tools/mpi-native/mpiexec.exe') -n $Ranks $parallelExe -parallel @ToolArgs
} else {
    & (Join-Path $foamBin ($Tool + '.exe')) @ToolArgs
}
exit $LASTEXITCODE
