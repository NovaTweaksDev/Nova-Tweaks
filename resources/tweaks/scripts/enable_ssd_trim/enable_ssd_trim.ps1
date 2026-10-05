param(
  [ValidateSet('On','Off','Check')]
  [string]$State = 'Check',
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'

function Invoke-Fsutil {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $Output = & fsutil.exe @Arguments 2>&1
  $ExitCode = $LASTEXITCODE

  if ($ExitCode -ne 0) {
    throw "fsutil failed with exit code $ExitCode. $($Output -join ' ')"
  }

  return @($Output)
}

function Get-TrimState {
  try {
    $Output = Invoke-Fsutil -Arguments @('behavior', 'query', 'DisableDeleteNotify')
  }
  catch {
    return 'UNKNOWN'
  }

  $NtfsState = $null

  foreach ($Line in $Output) {
    $Text = [string]$Line

    if ($Text -match '(?i)NTFS[^=]*=\s*([01])') {
      $NtfsState = [int]$Matches[1]
      break
    }
  }

  if ($null -eq $NtfsState) {
    return 'UNKNOWN'
  }

  if ($NtfsState -eq 0) {
    return 'ENABLED'
  }

  if ($NtfsState -eq 1) {
    return 'DISABLED'
  }

  return 'UNKNOWN'
}

try {
  switch ($State) {
    'On' {
      Invoke-Fsutil -Arguments @('behavior', 'set', 'DisableDeleteNotify', '0') | Out-Null

      if (-not $Silent) {
        Write-Output 'SSD TRIM notifications enabled.'
      }
    }

    'Off' {
      Invoke-Fsutil -Arguments @('behavior', 'set', 'DisableDeleteNotify', '1') | Out-Null

      if (-not $Silent) {
        Write-Output 'SSD TRIM notifications disabled.'
      }
    }

    'Check' {
      # Detection is intentionally read-only and must not modify system state.
      Write-Output (Get-TrimState)
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
