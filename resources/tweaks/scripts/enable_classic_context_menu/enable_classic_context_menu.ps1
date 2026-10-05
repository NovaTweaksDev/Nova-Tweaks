param(
    [ValidateSet('On', 'Off', 'Check')]
    [string]$State = 'Check',

    [switch]$Silent
)

$ErrorActionPreference = 'Stop'

$ClsidPath = 'HKCU:\Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'
$RegistryPath = "$ClsidPath\InprocServer32"

try {
    switch ($State) {
        'On' {
            New-Item -Path $RegistryPath -Force | Out-Null
            Set-Item -Path $RegistryPath -Value ''

            if (-not $Silent) {
                Write-Output 'Classic context menu enabled.'
            }

            Stop-Process -Name explorer -Force
        }

        'Off' {
            if (Test-Path $ClsidPath) {
                Remove-Item -Path $ClsidPath -Recurse -Force
            }

            if (-not $Silent) {
                Write-Output 'Classic context menu disabled.'
            }

            Stop-Process -Name explorer -Force
        }

        'Check' {
            $Enabled = $false
            if (Test-Path $RegistryPath) {
                $Key = Get-Item -LiteralPath $RegistryPath
                $Enabled = ($Key.GetValueNames() -contains '') -and ($Key.GetValue('') -eq '')
            }
            if ($Enabled) {
                Write-Output 'ENABLED'
            } else {
                Write-Output 'DISABLED'
            }
        }
    }
}
catch {
    if (-not $Silent) {
        Write-Error $_.Exception.Message
    }

    exit 1
}

exit 0