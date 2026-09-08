[CmdletBinding()]
param(
  [ValidateSet('Check', 'On', 'Off')]
  [string]$State = 'Check',

  [switch]$Silent
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TweakName = 'Optimize / Defrag Drives'

function Out-Result {
  param(
    [Parameter(Mandatory)]
    [string]$Status,

    [string]$Message = '',

    [hashtable]$Details = @{}
  )

  @{
    tweak   = $TweakName
    status  = $Status
    message = $Message
    details = $Details
  } | ConvertTo-Json -Compress -Depth 6
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object `
    Security.Principal.WindowsPrincipal($identity)

  return $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )
}

function Get-FixedDriveLetters {
  $driveLetters = @(
    Get-Volume -ErrorAction Stop |
      Where-Object {
        $_.DriveLetter -and
        ([string]$_.DriveType -eq 'Fixed')
      } |
      Sort-Object -Property DriveLetter |
      ForEach-Object {
        ([string]$_.DriveLetter).Trim().ToUpperInvariant()
      } |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
      }
  )

  Write-Output -NoEnumerate $driveLetters
}

function Invoke-DriveOptimization {
  param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[A-Z]$')]
    [string]$DriveLetter
  )

  $target = "${DriveLetter}:"
  $arguments = @(
    $target
    '/O'
    '/H'
    '/U'
  )

  $output = @(& "$env:SystemRoot\System32\defrag.exe" @arguments 2>&1)
  $exitCode = $LASTEXITCODE

  $outputText = (
    $output |
      ForEach-Object {
        [string]$_
      }
  ) -join "`n"

  $outputText = $outputText.Trim()

  if ($outputText.Length -gt 500) {
    $outputPreview = $outputText.Substring(0, 500)
  } else {
    $outputPreview = $outputText
  }

  @{
    drive          = $target
    success        = ($exitCode -eq 0)
    exit_code      = $exitCode
    output_preview = $outputPreview
  }
}

try {
  $defragPath = "$env:SystemRoot\System32\defrag.exe"

  if (-not (Test-Path -LiteralPath $defragPath -PathType Leaf)) {
    throw 'defrag.exe is not available on this system.'
  }

  switch ($State) {
    'Check' {
      $drives = @(
        Get-FixedDriveLetters |
          ForEach-Object {
            $_
          }
      )

      $driveCount = @($drives).Length

      Out-Result -Status 'Disabled' -Details @{
        available_drives = @($drives)
        drive_count      = $driveCount
        checked_at       = (Get-Date).ToString('o')
      }

      exit 0
    }

    'Off' {
      Out-Result `
        -Status 'Disabled' `
        -Message 'No rollback is required for this one-shot action.'

      exit 0
    }

    'On' {
      if (-not (Test-IsAdministrator)) {
        throw 'Administrator rights are required to optimize drives.'
      }

      $drives = @(
        Get-FixedDriveLetters |
          ForEach-Object {
            $_
          }
      )

      $driveCount = @($drives).Length

      if ($driveCount -eq 0) {
        throw 'No fixed drives with a drive letter were found.'
      }

      $results = @(
        foreach ($drive in $drives) {
          Invoke-DriveOptimization -DriveLetter ([string]$drive)
        }
      )

      $failedResults = @(
        $results |
          Where-Object {
            $_.success -eq $false
          }
      )

      $optimizedDrives = @(
        $results |
          Where-Object {
            $_.success -eq $true
          } |
          ForEach-Object {
            $_.drive
          }
      )

      $failedDrives = @(
        $failedResults |
          ForEach-Object {
            $_.drive
          }
      )

      $failedCount = @($failedResults).Length
      $optimizedCount = @($optimizedDrives).Length

      if ($failedCount -gt 0) {
        Out-Result `
          -Status 'Error' `
          -Message "Drive optimization failed for: $($failedDrives -join ', ')." `
          -Details @{
            optimized_drives = @($optimizedDrives)
            failed_drives    = @($failedDrives)
            results          = @($results)
            ran_at           = (Get-Date).ToString('o')
          }

        exit 1
      }

      Out-Result `
        -Status 'Disabled' `
        -Message "Optimization completed for $optimizedCount drive(s)." `
        -Details @{
          optimized_drives = @($optimizedDrives)
          results          = @($results)
          ran_at           = (Get-Date).ToString('o')
        }

      exit 0
    }
  }
} catch {
  Out-Result `
    -Status 'Error' `
    -Message $_.Exception.Message `
    -Details @{
      exception_type = $_.Exception.GetType().FullName
      script_line    = $_.InvocationInfo.ScriptLineNumber
      line           = $_.InvocationInfo.Line
      ran_at         = (Get-Date).ToString('o')
    }

  exit 1
}