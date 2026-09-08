[CmdletBinding()]
param(
  [ValidateSet('Check','On','Off')]
  [string]$State = 'Check',
  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Out-Result([string]$status, [string]$message = "") {
  @{
    tweak   = "Release IP Configuration"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

function Invoke-IpConfig {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $output = & ipconfig @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE

  [pscustomobject]@{
    Output   = $output.Trim()
    ExitCode = $exitCode
  }
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      $result = Invoke-IpConfig -Arguments @('/release')

      if ($result.ExitCode -ne 0) {
        throw "ipconfig /release failed with exit code $($result.ExitCode)"
      }

      Out-Result "Enabled" "IP configuration released"
    }

    'Off' {
      Out-Result "Disabled" "One-shot action; nothing to revert"
    }
  }

  exit 0
}
catch {
  Out-Result "Error" $_.Exception.Message
  exit 1
}
