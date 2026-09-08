PresentMon Service/API SDK binaries belong in this directory for packaged builds:

- PresentMonAPI.h
- PresentMonAPI2Loader.dll
- PresentMonAPI2Loader.lib
- Intel-PresentMon.dll
- LICENSE / NOTICE files from the PresentMon distribution

NovaTweaks loads this directory through the native NovaPresentMonHelper process. The legacy CLI under resources/capture/PresentMon is retained for diagnostics only and is not used for live FPS monitoring unless explicitly selected with NOVA_PRESENTMON_PROVIDER=cli-diagnostic.
