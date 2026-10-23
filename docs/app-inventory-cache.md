# Installed app detail cache

Nova stores versioned static app details in `apps/details-v1.json` under Electron's
userData directory. The existing separate development profile therefore has its
own cache. Cache-only IPC reads start no PowerShell scan and never authorize app
actions. Current process state, optimization analysis, uninstall commands and
permissions are not persisted.

The UI loads cached details, then the current Windows inventory, then full live
state. Registry/package metadata and inexpensive install-directory, executable
and icon file stats determine reuse. Directory sizes are recalculated for changed
entries, after seven days, or when Reload explicitly forces a refresh. Directory
mtime is only a change signal; nested changes without a version or metadata
change can remain undetected until the weekly/manual check.

Unreadable sizes remain unknown or retain their last verified value and timestamp.
Failed size checks retry on a later request after five minutes, rather than on
every list request. No background timer or filesystem watcher is installed.
Known zero-byte sizes are distinct from unavailable sizes. The size tooltip marks
cached/stale values. Corrupt, incompatible or future-dated cache files are misses;
atomic-write failures retain in-memory results. Failed inventory reads never prune
the stored list. Concurrent scans are serialized and identical requests share a
scan. Action invalidation cannot be overwritten by an earlier scan.

Uninstall resolves a new inventory and current uninstall command. Optimization
and restore recheck the selected app with fresh details before acting. Completed
optimization operations invalidate the corresponding cached entry. Process-path
normalization is memoized only within a scan; the process snapshot is always new.

## Local measurement, 2026-10-23

Windows host, 375 installed app entries, real read-only app scans with an isolated
cache under `.cache/apps-performance`. Times include optimization enrichment:

| Operation | Measured time |
| --- | ---: |
| Previous uncached implementation | 60.9 s |
| New initial detail scan | 27.4 s |
| Cache-only read from a new manager | 5 ms |
| Subsequent full inventory/live-state check | 11.5 s |

The subsequent check reused all 375 detail entries and refreshed zero static
detail entries. The 5 ms figure measures the backend cache read, not renderer
paint time. Measurements are specific to this machine; a first scan, changed apps
or inaccessible paths can still take longer. No real optimization or uninstall
was performed by this benchmark.
