namespace NovaGameDetector.Models;

public sealed class RunningProcessInfo
{
    public int Pid { get; set; }

    public string ProcessName { get; set; } = string.Empty;

    public string? ExePath { get; set; }

    public int? ParentPid { get; set; }
}
