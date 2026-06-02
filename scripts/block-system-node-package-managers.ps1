$ErrorActionPreference = "Stop"

$targets = @(
    @{
        Path = "C:\Program Files\nodejs\npm"
        Content = @'
#!/bin/sh
echo "npm esta bloqueado. Regla universal: usa pnpm." >&2
exit 1
'@
    },
    @{
        Path = "C:\Program Files\nodejs\npm.cmd"
        Content = @'
@echo off
echo npm esta bloqueado. Regla universal: usa pnpm.
exit /b 1
'@
    },
    @{
        Path = "C:\Program Files\nodejs\npm.ps1"
        Content = @'
Write-Error "npm esta bloqueado. Regla universal: usa pnpm."
exit 1
'@
    },
    @{
        Path = "C:\Program Files\nodejs\npx"
        Content = @'
#!/bin/sh
echo "npx esta bloqueado. Regla universal: usa pnpm exec o pnpm dlx." >&2
exit 1
'@
    },
    @{
        Path = "C:\Program Files\nodejs\npx.cmd"
        Content = @'
@echo off
echo npx esta bloqueado. Regla universal: usa pnpm exec o pnpm dlx.
exit /b 1
'@
    },
    @{
        Path = "C:\Program Files\nodejs\npx.ps1"
        Content = @'
Write-Error "npx esta bloqueado. Regla universal: usa pnpm exec o pnpm dlx."
exit 1
'@
    },
    @{
        Path = "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
        Content = @'
#!/usr/bin/env node
console.error("npm esta bloqueado. Regla universal: usa pnpm.");
process.exit(1);
'@
    },
    @{
        Path = "C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js"
        Content = @'
#!/usr/bin/env node
console.error("npx esta bloqueado. Regla universal: usa pnpm exec o pnpm dlx.");
process.exit(1);
'@
    }
)

$changed = @()

foreach ($target in $targets) {
    $path = $target.Path

    if (-not (Test-Path -LiteralPath $path)) {
        continue
    }

    $backup = "$path.pnpm-blocked-backup"
    if (-not (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $path -Destination $backup
    }

    Set-Content -LiteralPath $path -Value $target.Content -Encoding ASCII -NoNewline
    $changed += $path
}

$logPath = Join-Path $env:TEMP "pnpm-system-block.log"
if ($changed.Count -eq 0) {
    "No matching system npm/npx files were found." | Set-Content -LiteralPath $logPath -Encoding UTF8
} else {
    $changed | Set-Content -LiteralPath $logPath -Encoding UTF8
}

Write-Host "Bloqueo aplicado. Log: $logPath"
