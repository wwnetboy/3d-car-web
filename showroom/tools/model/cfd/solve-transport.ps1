param([Parameter(Mandatory=$true)][string]$Case,[Parameter(Mandatory=$true)][string]$Output,[string]$Seed='')
$ErrorActionPreference = 'Stop'
$foam=Join-Path $PSScriptRoot 'foam.ps1'
function Invoke-Foam([string]$name,[int]$ranks,[string[]]$arguments,[string]$log) {
    & $foam -Tool $name -Ranks $ranks -ToolArgs $arguments *> (Join-Path $Case $log)
    if ($LASTEXITCODE) { throw "$name failed; see $Case/$log" }
}
if ($Seed) {
    $boundaries=@{}
    foreach ($name in @('smoke','age','inletY','inletZ')) {
        $raw=[IO.File]::ReadAllText((Join-Path $Case "0/$name"))
        $boundaries[$name]=$raw.Substring($raw.IndexOf('boundaryField'))
    }
    Invoke-Foam 'mapFields' 1 @('-case',$Case,'-sourceTime','0','-consistent','-mapMethod','mapNearest',$Seed) 'log.map'
    foreach ($name in $boundaries.Keys) {
        $path=Join-Path $Case "0/$name"
        $raw=[IO.File]::ReadAllText($path)
        [IO.File]::WriteAllText($path,$raw.Substring(0,$raw.IndexOf('boundaryField'))+$boundaries[$name])
    }
}
Invoke-Foam 'decomposePar' 1 @('-case',$Case) 'log.decompose'
Invoke-Foam 'scalarTransportFoam' 8 @('-case',$Case) 'log.solve'
Invoke-Foam 'reconstructPar' 1 @('-case',$Case,'-latestTime') 'log.reconstruct'
python (Join-Path $PSScriptRoot 'sample.py') $Case
if ($LASTEXITCODE) { throw 'Sampling configuration failed' }
Invoke-Foam 'postProcess' 1 @('-case',$Case,'-latestTime','-dict','system/sampleFields') 'log.sample'
python (Join-Path $PSScriptRoot 'export.py') $Case $Output
if ($LASTEXITCODE) { throw 'Export validation failed' }
