# Store redistribution signing review

Reviewed 2026-10-13. The maintainer confirmed that Nova Tweaks remains free and
open source in the Store. Certum's Open Source certificate forbids commercially
distributed software; revisit the certificate before changing this model:
https://support.certum.eu/en/code-signing-required-documents/

The former rule prohibiting all signatures on third-party files was an internal
conservative packaging rule, not a Microsoft requirement or a blanket license
prohibition. The revised exception applies only to the 25 path/hash-pinned
unsigned PE files in scripts/store-redistribution-policy.json, only in signed
Store builds. Standard Stable/Preview/Local behavior remains unchanged.

| Files | Distribution basis and preserved records |
| --- | --- |
| Four unsigned Electron DLLs: dxcompiler, ffmpeg, vk_swiftshader, vulkan-1 | Official Electron 44.0.0 runtime; original Electron MIT license and complete Chromium licenses/notices remain bundled. The respective LLVM/FFmpeg/SwiftShader/Vulkan terms remain applicable, not replaced by Electron's MIT license. |
| LibreHardwareMonitor.exe, LibreHardwareMonitorLib.dll | MPL-2.0; complete corresponding source snapshot and source hash already bundled. https://www.mozilla.org/en-US/MPL/2.0/ sections 2.1, 3.2 and 3.4 permit distribution subject to source and notice obligations. |
| Aga.Controls.dll | Original BSD notice and source remain in the LHM snapshot. |
| BlackSharp.Core.dll, DiskInfoToolkit.dll, RAMSPDToolkit-NDD.dll | MPL-2.0; exact NuGet source commits and original license texts added under licenses/StoreRedistribution. |
| OxyPlot.dll, OxyPlot.WindowsForms.dll | MIT; original copyright/license and version-specific source recorded under licenses/StoreRedistribution. |
| Microsoft.Win32.TaskScheduler.dll and 11 translation DLLs | MIT; exact source commit and original license text recorded under licenses/StoreRedistribution. |
| PresentMonLegacy.exe | Original official Intel PresentMon 1.10.0 MIT binary; license/copyright/notices already bundled. No executable code is modified. |

Authenticode here attests distributor identity and package integrity. It does
not transfer copyright or imply upstream endorsement. Every existing signed
upstream file stays byte-for-byte unchanged with its original signer.

Before signing, full original file hashes and original aggregate sidecar/runtime
pins must pass. Afterwards, all bytes except the PE checksum, certificate-table
directory entry, alignment padding and appended Authenticode certificate table
must retain their pinned content hash. Store validation requires the exact Nova
certificate, a valid timestamp and SignTool verification; unsigned exceptions
are still forbidden. The full signed resource hashes are embedded in fused,
integrity-checked ASAR for runtime validation.

This resolves a technical signing path, not Store certification. Driver
disclosure, supported-system-configuration review and exact-installer VM tests
remain separate. Results of actual Store packaging must be recorded before
calling this signing blocker resolved.
