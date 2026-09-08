using System.Runtime.InteropServices;
using System.Text;
using NovaGameDetector.Models;

namespace NovaGameDetector.Detection;

public sealed class ProcessScanner
{
    private const uint Th32csSnapprocess = 0x00000002;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private static readonly IntPtr InvalidHandleValue = new(-1);

    public IReadOnlyList<RunningProcessInfo> ScanRunningProcesses()
    {
        var processes = new Dictionary<int, RunningProcessInfo>();

        foreach (var snapshotEntry in EnumerateSnapshotEntries())
        {
            if (snapshotEntry.ProcessId <= 0)
            {
                continue;
            }

            var processName = NormalizeProcessName(snapshotEntry.ExeFileName);
            if (string.IsNullOrWhiteSpace(processName))
            {
                continue;
            }

            var processInfo = new RunningProcessInfo
            {
                Pid = snapshotEntry.ProcessId,
                ProcessName = processName,
                ExePath = TryResolveExecutablePath(snapshotEntry.ProcessId),
                ParentPid = snapshotEntry.ParentProcessId > 0 ? snapshotEntry.ParentProcessId : null
            };

            processes[snapshotEntry.ProcessId] = processInfo;
        }

        return processes
            .Values
            .OrderBy((entry) => entry.Pid)
            .ToList();
    }

    private static IEnumerable<SnapshotEntry> EnumerateSnapshotEntries()
    {
        var snapshotHandle = CreateToolhelp32Snapshot(Th32csSnapprocess, 0);
        if (snapshotHandle == InvalidHandleValue)
        {
            yield break;
        }

        try
        {
            var entry = new ProcessEntry32
            {
                DwSize = (uint)Marshal.SizeOf<ProcessEntry32>()
            };

            if (!Process32First(snapshotHandle, ref entry))
            {
                yield break;
            }

            do
            {
                yield return new SnapshotEntry(
                    unchecked((int)entry.Th32ProcessID),
                    unchecked((int)entry.Th32ParentProcessID),
                    entry.SzExeFile);

                entry.DwSize = (uint)Marshal.SizeOf<ProcessEntry32>();
            }
            while (Process32Next(snapshotHandle, ref entry));
        }
        finally
        {
            CloseHandle(snapshotHandle);
        }
    }

    private static string? TryResolveExecutablePath(int pid)
    {
        IntPtr processHandle = IntPtr.Zero;

        try
        {
            processHandle = OpenProcess(ProcessQueryLimitedInformation, false, (uint)pid);
            if (processHandle == IntPtr.Zero)
            {
                return null;
            }

            var capacity = 32767;
            var buffer = new StringBuilder(capacity);

            if (!QueryFullProcessImageName(processHandle, 0, buffer, ref capacity))
            {
                return null;
            }

            return NormalizeWindowsPath(buffer.ToString());
        }
        catch
        {
            return null;
        }
        finally
        {
            if (processHandle != IntPtr.Zero)
            {
                CloseHandle(processHandle);
            }
        }
    }

    private static string NormalizeProcessName(string value)
    {
        var candidate = Path.GetFileName((value ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return string.Empty;
        }

        if (!candidate.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) &&
            !candidate.Contains('.'))
        {
            return $"{candidate}.exe";
        }

        return candidate;
    }

    private static string NormalizeWindowsPath(string value)
    {
        var candidate = Environment.ExpandEnvironmentVariables((value ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return string.Empty;
        }

        try
        {
            candidate = Path.GetFullPath(candidate);
        }
        catch
        {
            // Keep best-effort path when normalization fails.
        }

        return candidate.Replace('/', '\\');
    }

    private readonly record struct SnapshotEntry(int ProcessId, int? ParentProcessId, string ExeFileName);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry32
    {
        public uint DwSize;
        public uint CntUsage;
        public uint Th32ProcessID;
        public IntPtr Th32DefaultHeapID;
        public uint Th32ModuleID;
        public uint CntThreads;
        public uint Th32ParentProcessID;
        public int PcPriClassBase;
        public uint DwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string SzExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")]
    private static extern bool Process32First(IntPtr hSnapshot, ref ProcessEntry32 lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")]
    private static extern bool Process32Next(IntPtr hSnapshot, ref ProcessEntry32 lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool QueryFullProcessImageName(
        IntPtr hProcess,
        uint dwFlags,
        StringBuilder lpExeName,
        ref int lpdwSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
