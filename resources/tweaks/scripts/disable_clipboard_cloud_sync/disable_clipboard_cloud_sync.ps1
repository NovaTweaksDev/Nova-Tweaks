param(
  [ValidateSet('On','Off','Check')]
  [string]$State = 'Check',
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'

$RegistryPath = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\System'
$ValueName = 'AllowCrossDeviceClipboard'

try {
  switch ($State) {
    'On' {
      # Disable cross-device clipboard synchronization through the supported Windows policy.
      if (-not (Test-Path -LiteralPath $RegistryPath)) {
        New-Item -Path $RegistryPath -Force | Out-Null
      }

      New-ItemProperty `
        -Path $RegistryPath `
        -Name $ValueName `
        -Value 0 `
        -PropertyType DWord `
        -Force | Out-Null

      if (-not $Silent) {
        Write-Output 'Clipboard cloud synchronization disabled.'
      }
    }

    'Off' {
      # Remove only the policy introduced by this tweak and return Windows to its default behavior.
      if (Test-Path -LiteralPath $RegistryPath) {
        Remove-ItemProperty `
          -Path $RegistryPath `
          -Name $ValueName `
          -ErrorAction SilentlyContinue
      }

      if (-not $Silent) {
        Write-Output 'Clipboard cloud synchronization policy restored to default.'
      }
    }

    'Check' {
      # Detection is intentionally read-only.
      if (-not (Test-Path -LiteralPath $RegistryPath)) {
        Write-Output 'DISABLED'
        exit 0
      }

      try {
        $Property = Get-ItemProperty `
          -LiteralPath $RegistryPath `
          -Name $ValueName `
          -ErrorAction Stop

        $Value = $Property.$ValueName

        if ($Value -eq 0) {
          # The tweak is active: cross-device clipboard synchronization is blocked.
          Write-Output 'ENABLED'
        }
        elseif ($Value -eq 1) {
          # An explicit policy allows synchronization, so this tweak is not active.
          Write-Output 'DISABLED'
        }
        else {
          Write-Output 'UNKNOWN'
        }
      }
      catch [System.Management.Automation.PSArgumentException] {
        # Missing value means the policy is not configured and the tweak is not active.
        Write-Output 'DISABLED'
      }
      catch [System.Management.Automation.ItemNotFoundException] {
        Write-Output 'DISABLED'
      }
      catch {
        Write-Output 'UNKNOWN'
      }
    }
  }

  exit 0
}
catch {
  if (-not $Silent) {
    Write-Error $_.Exception.Message
  }

  exit 1
}
