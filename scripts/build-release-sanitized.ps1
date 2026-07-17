$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$remaps = @(
    @($env:USERPROFILE, "/build/user"),
    @($cargoHome, "/build/cargo"),
    @($repoRoot, "/workspace/txteditor")
)
$flags = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $remaps) {
    if (-not [string]::IsNullOrWhiteSpace($entry[0])) {
        $flags.Add("--remap-path-prefix=$($entry[0])=$($entry[1])")
    }
}

$previous = $env:CARGO_ENCODED_RUSTFLAGS
try {
    $env:CARGO_ENCODED_RUSTFLAGS = $flags -join [char]0x1f
    & npm.cmd run tauri -- build
    if ($LASTEXITCODE -ne 0) { throw "TXTEditor release build failed with exit code $LASTEXITCODE." }
}
finally {
    $env:CARGO_ENCODED_RUSTFLAGS = $previous
}
