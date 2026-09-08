NovaPresentMonHelper.exe belongs in this directory for packaged builds.

Expected contract:

```text
NovaPresentMonHelper.exe --target-process-name FortniteClient-Win64-Shipping.exe --poll-ms 500 --presentmon-path <resources/tools/presentmon>
NovaPresentMonHelper.exe --target-pid 20252 --poll-ms 500 --presentmon-path <resources/tools/presentmon>
```

The helper writes JSON Lines to stdout:

```jsonl
{"type":"status","status":"starting"}
{"type":"status","status":"connected"}
{"type":"metrics","pid":20252,"processName":"FortniteClient-Win64-Shipping.exe","fps":121.6,"frameTimeMs":8.22,"avgFps":119.4,"onePercentLow":94.2}
{"type":"error","message":"PresentMon Service is unavailable"}
```
