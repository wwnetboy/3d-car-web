param([string]$SevenZip = '')
$ErrorActionPreference = 'Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$cache=Join-Path $projectRoot '.artifacts/cfd-tools'
New-Item -ItemType Directory -Force $cache | Out-Null
if (-not $SevenZip) {
    $candidate=Get-Command 7z.exe -ErrorAction SilentlyContinue
    if ($candidate) { $SevenZip=$candidate.Source }
    else {
        foreach ($candidate in @('C:/Program Files/7-Zip/7z.exe','C:/Program Files/NVIDIA Corporation/NVIDIA App/7z.exe')) {
            if (Test-Path -LiteralPath $candidate) { $SevenZip=$candidate; break }
        }
    }
}
if (-not $SevenZip) { throw 'Provide -SevenZip with the path to a full 7-Zip executable (7z.exe).' }
$installer=Join-Path $cache 'OpenFOAM-v2506-windows-mingw.exe'
if (-not (Test-Path -LiteralPath $installer)) {
    Invoke-WebRequest 'https://downloads.sourceforge.net/project/openfoam/v2506/OpenFOAM-v2506-windows-mingw.exe' -OutFile $installer
}
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne '2FD74303B62589B58504F40175CF48BBA26AB8E866C3E3937A650F3C4B233D29') { throw 'Unexpected OpenFOAM archive checksum' }
if ((Get-AuthenticodeSignature -LiteralPath $installer).Status -ne 'Valid') { throw 'OpenFOAM installer signature is not valid' }
$runtime=Join-Path $cache 'OpenFOAM'
$foamBin=Join-Path $runtime 'msys64/home/ofuser/OpenFOAM/OpenFOAM-v2506/platforms/win64MingwDPInt32Opt/bin'
if (-not (Test-Path -LiteralPath (Join-Path $foamBin 'simpleFoam.exe'))) {
    & $SevenZip x $installer "-o$runtime" -y
    if ($LASTEXITCODE) { throw 'OpenFOAM extraction failed' }
    & $SevenZip x (Join-Path $runtime 'msys64.7z') "-o$runtime" -y
    if ($LASTEXITCODE) { throw 'OpenFOAM runtime extraction failed' }
}
$mpi=Join-Path $cache 'mpi-native'
if (-not (Test-Path -LiteralPath (Join-Path $mpi 'msmpi64.dll'))) {
    # The signed bootstrapper embeds two OLE/MSI streams. Extract the second
    # (x64) MSI as a whole: its internal CAB stream is sector-fragmented.
    $bootstrap=Join-Path $runtime 'thirdParty/msmpisetup.exe'
    $msi=Join-Path $cache 'mpi-x64.msi'
    python -c "import pathlib,sys; b=pathlib.Path(sys.argv[1]).read_bytes(); marker=bytes.fromhex('d0cf11e0a1b11ae1'); p=b.rfind(marker); assert p>0; pathlib.Path(sys.argv[2]).write_bytes(b[p:])" $bootstrap $msi
    if ($LASTEXITCODE) { throw 'MPI MSI extraction failed' }
    & $SevenZip x $msi "-o$mpi" -y
    if ($LASTEXITCODE -gt 1) { throw 'MPI extraction failed' }
    Copy-Item -LiteralPath (Join-Path $mpi 'msmpi64.dll') -Destination (Join-Path $mpi 'msmpi.dll')
    Copy-Item -LiteralPath (Join-Path $mpi 'msmpires64.dll') -Destination (Join-Path $mpi 'msmpires.dll')
}
$serial=Join-Path $foamBin 'libPstream.dll'
$dummy=Join-Path $foamBin 'libPstream.dll-dummy'
if ((Get-FileHash -LiteralPath $serial).Hash -ne (Get-FileHash -LiteralPath $dummy).Hash) { Copy-Item -LiteralPath $dummy -Destination $serial }
python -m pip install --target (Join-Path $projectRoot '.artifacts/cfd-python') --only-binary=:all: -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE) { throw 'Local Python dependencies failed' }
& (Join-Path $PSScriptRoot 'foam.ps1') -Tool simpleFoam -ToolArgs @('-help')
if ($LASTEXITCODE) { throw 'OpenFOAM executable check failed' }
Write-Output 'CFD tools ready in .artifacts. No system installation or registry change was required.'
