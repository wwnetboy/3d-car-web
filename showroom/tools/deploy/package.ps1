$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location -LiteralPath $projectRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    $output = Join-Path $projectRoot 'dist'
    $files = @(Get-ChildItem -LiteralPath $output -File -Recurse)
    if ($files.Count -gt 20000) { throw 'EdgeOne file count limit exceeded.' }
    if ($files | Where-Object { $_.Length -gt 25000000 }) { throw 'EdgeOne per-file size limit exceeded.' }
    foreach ($required in @('index.html', 'edgeone.json', 'models/vision-gt.glb', 'models/vision-gt-lite.glb')) {
        if (-not (Test-Path -LiteralPath (Join-Path $output $required))) { throw "Missing $required" }
    }
    $artifacts = Join-Path $projectRoot '.artifacts'
    New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
    $archive = Join-Path $artifacts ('xiaomi-vision-gt-eo-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.zip')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    # Windows PowerShell/.NET Framework may write backslashes into local ZIP
    # headers even when readers normalize the central directory to slashes.
    # Pass explicit portable entry names to keep both headers consistent.
    $writer = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            $entryName = $file.FullName.Substring($output.Length + 1).Replace('\', '/')
            foreach ($component in $entryName.Split('/')) {
                if (-not $component -or $component -match '[\\:*?"<>|]' -or $component -eq '..') {
                    throw "Invalid ZIP entry: $entryName"
                }
            }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $writer, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally { $writer.Dispose() }
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        if (-not ($zip.Entries | Where-Object { $_.FullName -eq 'index.html' })) { throw 'ZIP entry point must be at root.' }
        if ($zip.Entries.Count -ne $files.Count) { throw 'ZIP file count mismatch.' }
        if ($zip.Entries | Where-Object { $_.FullName.Contains('\') }) { throw 'ZIP paths must use forward slashes.' }
    } finally { $zip.Dispose() }
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    "$hash  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath ($archive + '.sha256') -Encoding ascii
    Write-Output "Archive: $archive"
    Write-Output "Files: $($files.Count)"
    Write-Output "ZIP bytes: $((Get-Item -LiteralPath $archive).Length)"
    Write-Output "SHA256: $hash"
} finally { Pop-Location }
