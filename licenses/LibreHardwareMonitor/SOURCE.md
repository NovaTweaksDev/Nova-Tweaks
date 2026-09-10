# LibreHardwareMonitor source offer

Nova Tweaks distributes a locally built LibreHardwareMonitor 0.9.6 runtime
under the Mozilla Public License 2.0. It is not the executable from the
official upstream v0.9.6 release archive.

The complete corresponding source snapshot used for the distributed runtime
is included with every Nova Tweaks package at
`licenses/LibreHardwareMonitor/source`. The same source is maintained in this
repository at `resources/monitoring/LibreHardwareMonitor`.

The packaged source snapshot intentionally excludes generated `bin`, `obj`,
and `patched` directories, editor/CI metadata, and `PawnIO_setup.exe`. Nova
Tweaks does not distribute PawnIO Setup because no authoritative license for
redistributing that separate installer wrapper was available. The
LibreHardwareMonitor project was adjusted so the installer is neither embedded
nor offered at runtime.

Source snapshot SHA-256 (Nova deterministic directory format
`nova-third-party-source-v2`):

`1745DC844B7356B203176DC569AF6B07A1D8D2FA4EA5D42C7C3CEE5454CBE257`

The checked-in runtime can be rebuilt on Windows with the .NET 8 SDK. The build
restores its NuGet package graph automatically:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-lhm-runtime.ps1
```

The script builds the `net472`/`win-x64` Release target so the sidecar uses the
.NET Framework supplied with supported Windows versions. It copies the runtime
files into the reviewed `patched` directory and fails if
`PawnIO_setup.exe` is present or embedded in the rebuilt application assembly.

Upstream project: https://github.com/LibreHardwareMonitor/LibreHardwareMonitor

Upstream release associated with version 0.9.6:
https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.6
