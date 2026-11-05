param([Parameter(Mandatory=$true)][string]$Case)
$ErrorActionPreference = 'Stop'
$foam = Join-Path $PSScriptRoot 'foam.ps1'
& $foam -Tool blockMesh -ToolArgs @('-case',$Case) *> (Join-Path $Case 'log.blockMesh')
if ($LASTEXITCODE) { throw 'blockMesh failed' }
& $foam -Tool snappyHexMesh -ToolArgs @('-case',$Case,'-overwrite') *> (Join-Path $Case 'log.snappy')
if ($LASTEXITCODE) { throw 'snappyHexMesh failed' }
for ($pass = 0; $pass -lt 6; $pass++) {
    & $foam -Tool checkMesh -ToolArgs @('-case',$Case,'-allTopology','-allGeometry') *> (Join-Path $Case 'log.checkMesh')
    python (Join-Path $PSScriptRoot 'prune.py') $Case
    if ($LASTEXITCODE -eq 0) { break }
    if ($LASTEXITCODE -ne 2) { throw 'Mesh stencil audit failed' }
    & $foam -Tool subsetMesh -ToolArgs @('-case',$Case,'-overwrite','-patches','(car_.* ground)','resolvedFluid') *> (Join-Path $Case "log.subset-$pass")
    if ($LASTEXITCODE) { throw 'Mesh stencil removal failed' }
}
& $foam -Tool checkMesh -ToolArgs @('-case',$Case) *> (Join-Path $Case 'log.quality')
if (-not (Select-String -LiteralPath (Join-Path $Case 'log.quality') -SimpleMatch 'Mesh OK.')) { throw 'Mesh did not pass OpenFOAM quality checks' }
