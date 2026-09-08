# NovaPresentMonHelper

Native x64 stdout bridge for NovaTweaks Game Mode FPS monitoring.

The helper connects to PresentMon Service/API, tracks one game process, consumes live frame metrics, and writes JSON Lines to stdout for Electron.

## CLI

```powershell
NovaPresentMonHelper.exe --target-process-name FortniteClient-Win64-Shipping.exe --poll-ms 500 --presentmon-path .\resources\tools\presentmon
NovaPresentMonHelper.exe --target-pid 20252 --poll-ms 500 --presentmon-path .\resources\tools\presentmon
```

`--presentmon-path` is optional, but recommended. It should point at the folder containing:

- `PresentMonAPI.h`
- `PresentMonAPI2Loader.dll`
- `PresentMonAPI2Loader.lib`
- `Intel-PresentMon.dll`

## Output

```jsonl
{"type":"status","status":"starting"}
{"type":"status","status":"connected"}
{"type":"metrics","pid":20252,"processName":"FortniteClient-Win64-Shipping.exe","fps":121.6,"frameTimeMs":8.22}
{"type":"error","message":"..."}
```

## Build

From a Visual Studio Developer PowerShell:

```powershell
.\tools\nova-presentmon-helper\build.ps1 -Configuration Release -Platform x64
```

This generates a Visual Studio solution in:

```text
tools\nova-presentmon-helper\build\x64\NovaPresentMonHelper.sln
```

and copies the release binary to:

```text
tools\nova-presentmon-helper\bin\NovaPresentMonHelper.exe
resources\tools\nova-presentmon-helper\NovaPresentMonHelper.exe
```

## Include And Lib Paths

The CMake project uses:

```text
Include: resources\tools\presentmon
Library: resources\tools\presentmon\PresentMonAPI2Loader.lib
Runtime DLL path: supplied with --presentmon-path
```

The MSVC build links `delayimp.lib` and uses:

```text
/DELAYLOAD:PresentMonAPI2Loader.dll
```

so the helper can explicitly load `PresentMonAPI2Loader.dll` from `--presentmon-path` before the first API call.
