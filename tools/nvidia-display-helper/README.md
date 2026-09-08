# nvidia-display-helper

Small CLI helper for NVIDIA display-level color controls.

## Commands

- `get-digital-vibrance --display primary`
- `set-digital-vibrance --display primary --value 62`
- `get-output-color-range --display primary`
- `set-output-color-range --display primary --value full`
- `set-output-color-range --display primary --value limited`

Successful commands emit one JSON object on stdout. Digital Vibrance values are
normalized to the user-facing range from 0 through 100. Output color range uses
`Full` or `Limited`; a driver-owned `BestQuality` state is reported as `Auto`.

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
