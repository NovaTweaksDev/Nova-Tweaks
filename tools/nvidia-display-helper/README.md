# nvidia-display-helper

CLI helper for captured Windows display profiles and NVIDIA display-level color controls.

## Commands

- `get-digital-vibrance --display primary`
- `set-digital-vibrance --display primary --value 62`
- `get-output-color-range --display primary`
- `set-output-color-range --display primary --value full`
- `set-output-color-range --display primary --value limited`

Successful commands emit one JSON object on stdout. Digital Vibrance values are
normalized to the user-facing range from 0 through 100. Output color range uses
`Full` or `Limited`; a driver-owned `BestQuality` state is reported as `Auto`.

## Display profiles

The existing color commands above keep their contracts. Profile commands work
with an explicitly identified active monitor rather than the Windows primary
display. Windows mode commands do not require an NVIDIA driver.

- `profile-list`: JSON discovery of independent active displays and optional
  capabilities. Cloned displays and unavailable timings are not selectable.
- `profile-capture --monitor <UTF-8 identity encoded as hex>`: capture the
  active desktop mode, exact rational refresh, output timing and available
  NVIDIA scaling. `--vibrance` includes raw vibrance restoration. The app automatically includes
  it whenever reliably available; output color range is never captured.
- `profile-validate --monitor <hex> --token <snapshot>`: read-only preflight
  against enumerated driver modes and Windows display validation.
- `profile-merge --monitor <hex> --token <snapshot> --fallback-token <live snapshot>`:
  read-only composition. Vibrance absent from a legacy profile inherits its
  reliable live value; explicitly saved vibrance remains unchanged. Resolution,
  refresh, output signal and scaling always come from the first snapshot.
- `profile-apply --monitor <hex> --token <snapshot>`: apply captured settings.
  Saves Windows source/target modes with `SDC_SAVE_TO_DATABASE` so the selected
  resolution and refresh rate survive reboot. Native recovery also saves its
  restored mode; `profile-validate` never writes the display database.
  Caller must arm the recovery guard first and verify the resulting state.
- `profile-watch --monitor <hex> --token <original> --owner <pid>`: independent
  recovery process. Emits `ready`, accepts `expected <applied snapshot>`,
  `confirm`, `restore`, and `disarm` on stdin. Without confirmation it restores
  after 15 seconds. Confirmed sessions recover on owner exit, unless monitor,
  driver or managed settings changed outside Nova. `--confirmed` is reserved
  for previously tested automatic profiles.

Snapshots are versioned, size-checked native records without pointers. Desktop
and output signal modes are distinct; custom timings are never created. Monitor
layout and color depth are not managed. Reserved v1 color fields preserve binary
compatibility; decoding clears legacy output range before apply or recovery.
Digital Vibrance uses the existing driver interfaces and may be unavailable
after a driver change. The standalone color-range tweak commands are unchanged.

NVIDIA scaling is verified after guarded application. Some drivers were observed
to change scaling even with NVAPI's validate-only flag; preflight deliberately
does not call that setter. Availability means readable interfaces, not a
confirmed user profile. Automation requires a successful manual profile test.

The guard must be launched with `detached: true, windowsHide: true` on Windows:
ordinary libuv child processes can be killed with their owner. Pipes remain open
for commands; owner termination or pipe closure activates native recovery.

### Validation

Normal `npm test` exercises mocked service behavior and skips hardware changes.
To explicitly run the native hardware test from PowerShell:

```powershell
$env:NOVA_DISPLAY_HARDWARE_TEST = '1'
node --test electron/services/displayProfiles/displayProfileNative.test.js
Remove-Item Env:NOVA_DISPLAY_HARDWARE_TEST
```

This test temporarily changes supported NVIDIA scaling and restores it. It
checks read-only preflight, round trip, the 15-second timeout, owner termination
and preservation of other displays. It does not test game rendering, different
desktop resolutions, disconnected monitors or every driver family.

## Build

```powershell
.\build.ps1
```

## Compatibility

Display discovery and output color range use public NVAPI interfaces. Setting
an output range preserves the other reported color fields and switches the color
selection policy to `User`. The public setter does not reliably expose the
driver-owned `BestQuality` policy, so the CLI detects that state as `Auto` but
does not offer it as a set command. Digital
Vibrance uses driver interfaces resolved through
`NvAPI_QueryInterface` because the current public NVAPI SDK does not expose a
documented DVC setter. Missing interfaces fail closed and return a non-zero exit
code.
