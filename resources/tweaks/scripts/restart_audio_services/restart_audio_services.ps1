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
    tweak   = "Restart Audio Services"
    status  = $status
    message = $message
  } | ConvertTo-Json -Compress
}

function Restart-ServiceSafe {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $service = Get-Service -Name $Name -ErrorAction Stop

  if ($service.Status -eq 'Running') {
    Restart-Service -Name $Name -Force -ErrorAction Stop
  }
  else {
    Start-Service -Name $Name -ErrorAction Stop
  }
}

try {
  switch ($State) {

    'Check' {
      Out-Result "Disabled" "One-shot action; no persistent state"
    }

    'On' {
      Restart-ServiceSafe -Name 'AudioEndpointBuilder'
      Restart-ServiceSafe -Name 'Audiosrv'

      Out-Result "Enabled" "Audio services restarted"
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
