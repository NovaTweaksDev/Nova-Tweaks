# nvidia-profile-helper

Small CLI helper for NVIDIA profile presets via NVAPI DRS.

## Commands

- `apply --preset competitive`
- `apply --preset balanced`
- `apply --preset quality`
- `detect-refresh`
- `restore-defaults`

## Build

```powershell
.\tools\nvidia-profile-helper\build.ps1
```

The wrapper script expects:

`tools\nvidia-profile-helper\bin\nvidia-profile-helper.exe`

## Notes

- Uses NVAPI/DRS directly (`nvapi64.dll` / `nvapi.dll`).
- The helper changes only the reviewed global/base profile settings declared in
  `src/main.cpp`.
- Settings without stable public NVAPI DRS mappings are intentionally excluded.
