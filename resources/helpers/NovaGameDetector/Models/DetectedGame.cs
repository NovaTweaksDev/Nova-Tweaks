namespace NovaGameDetector.Models;

public sealed class DetectedGame
{
    public string Id { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string ProcessName { get; set; } = string.Empty;

    public int Pid { get; set; }

    public string ExePath { get; set; } = string.Empty;

    public string? InstallDir { get; set; }

    public string? Launcher { get; set; }

    public string State { get; set; } = "running_background";

    public int Confidence { get; set; }

    public List<string> Reasons { get; set; } = [];

    public DateTimeOffset DetectedAt { get; set; }

    public DateTimeOffset? LastForegroundAt { get; set; }
}
