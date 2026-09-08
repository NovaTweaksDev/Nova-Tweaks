# Third-Party Notices

Nova Tweaks is licensed under the GNU General Public License version 3 only
(`GPL-3.0-only`). The complete project license is preserved in [`LICENSE`](LICENSE).
The separate Nova Tweaks trademark policy is preserved in
[`TRADEMARKS.MD`](TRADEMARKS.MD).

Nova Tweaks also includes separately distributed third-party software. Each
component remains subject to its own license terms and copyright notices. The
original, unabridged upstream license and notice files are preserved under
[`licenses/`](licenses/). Binary versions, origins, packaged paths, source
availability and SHA-256 hashes are recorded in
[`third-party-components.json`](third-party-components.json).

## LibreHardwareMonitor

- **Project:** LibreHardwareMonitor
- **Bundled file:** `LibreHardwareMonitor.exe`
- **Repository path:** `resources/monitoring/LibreHardwareMonitor/patched/LibreHardwareMonitor.exe`
- **Version:** 0.9.6
- **License:** Mozilla Public License 2.0 (`MPL-2.0`)
- **Copyright:** LibreHardwareMonitor contributors; upstream and dependency
  notices are preserved in the files linked below.
- **Official project/source:** https://github.com/LibreHardwareMonitor/LibreHardwareMonitor
- **Upstream release associated with the version:** https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/tag/v0.9.6
- **Full license text:** [`licenses/LibreHardwareMonitor/LICENSE.txt`](licenses/LibreHardwareMonitor/LICENSE.txt)
- **Official upstream third-party notices:** [`licenses/LibreHardwareMonitor/THIRD-PARTY-NOTICES.txt`](licenses/LibreHardwareMonitor/THIRD-PARTY-NOTICES.txt)
- **Corresponding source and build instructions:** [`licenses/LibreHardwareMonitor/SOURCE.md`](licenses/LibreHardwareMonitor/SOURCE.md)
- **Executable SHA-256:** `43C1013E291CE0B386104ADE1080B87A7A20D013532E56205A49B7F9F4A8F46E`
- **Application assembly SHA-256:** `25B4ECF296B3F9FCC9F8FFCD7F602075618683F6605F9D43A0E08C9056405C76`
- **Source snapshot SHA-256:** `83D750E8642192735FA59511A3F02A75FB49B0D8FB519D6E227E1244C24A2BFF`

The bundled executable is a Nova-maintained local build, not the executable
from the official upstream v0.9.6 release archive. Every package includes the
complete corresponding filtered source snapshot at
`licenses/LibreHardwareMonitor/source`. The deterministic source hash and file
count are verified during tests, packaging and post-signing validation.

Nova's build removes `PawnIO_setup.exe` from the source and embedded resources.
The separate PawnIO Setup wrapper is not distributed because its official
release repository does not provide authoritative redistribution terms. This
does not disable LibreHardwareMonitor's normal sensor runtime; systems that
already have a compatible PawnIO driver may still expose the related sensors.

LibreHardwareMonitor is third-party software and is not Nova-owned code.

## PresentMon

### PresentMon.exe

- **Project:** PresentMon
- **Bundled file:** `PresentMon.exe`
- **Version:** 2.5.1
- **Copyright:** Copyright (C) 2017-2024 Intel Corporation
- **License:** MIT License
- **Official project/source:** https://github.com/GameTechDev/PresentMon
- **Official release:** https://github.com/GameTechDev/PresentMon/releases/tag/v2.5.1
- **Official asset:** https://github.com/GameTechDev/PresentMon/releases/download/v2.5.1/PresentMon-2.5.1-x64.exe
- **Full license text:** [`licenses/PresentMon/LICENSE.txt`](licenses/PresentMon/LICENSE.txt)
- **Upstream third-party notices:** [`licenses/PresentMon/THIRD_PARTY.txt`](licenses/PresentMon/THIRD_PARTY.txt)
- **SHA-256:** `9BEC3083069F58F911E6A512F4806DB51A27BD096103087BC1D05EF54C80A191`

The local hash matches the SHA-256 digest published in the official GitHub
release metadata. The existing Intel Authenticode signature is preserved.

### PresentMonLegacy.exe

- **Project:** PresentMon
- **Bundled file:** `PresentMonLegacy.exe`
- **Version:** 1.10.0
- **Copyright:** Copyright (C) 2017-2023 Intel Corporation
- **License:** MIT License
- **Official project/source:** https://github.com/GameTechDev/PresentMon
- **Official release:** https://github.com/GameTechDev/PresentMon/releases/tag/v1.10.0
- **Official asset:** https://github.com/GameTechDev/PresentMon/releases/download/v1.10.0/PresentMon-1.10.0-x64.exe
- **Full license text:** [`licenses/PresentMon/v1.10.0/LICENSE.txt`](licenses/PresentMon/v1.10.0/LICENSE.txt)
- **Upstream third-party notices:** [`licenses/PresentMon/v1.10.0/THIRD_PARTY.txt`](licenses/PresentMon/v1.10.0/THIRD_PARTY.txt)
- **SHA-256:** `E57A2F8EE1DE1EF1A5516D875F1B115E881943CD729FE9C5A2F88B1DC79A8A3B`

The official v1.10.0 release metadata does not publish an asset digest. The
recorded hash was independently calculated from the official release URL and
matches the bundled binary exactly. The upstream asset is not
Authenticode-signed.

Both PresentMon files are third-party software and are not Nova-owned code.

## Signing policy

Nova Tweaks release signing must never add, remove or replace signatures on:

- `LibreHardwareMonitor.exe`
- `PresentMon.exe`
- `PresentMonLegacy.exe`

Only Nova-owned binaries may be signed with the Nova Tweaks/SignPath
certificate. Release automation preserves the hashes recorded above and uses
explicit signing exclusions for these three executable names. The valid Intel
signature on `PresentMon.exe` is retained; the unsigned LibreHardwareMonitor
and PresentMonLegacy files remain unsigned. `PawnIO_setup.exe` is rejected if
it appears in either the repository payload or a packaged application.
