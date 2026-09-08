namespace NovaGameDetector.Models;

public sealed class KnownGame
{
    public string Id { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public List<string> ProcessNames { get; set; } = [];

    public List<string> ExcludeProcesses { get; set; } = [];

    public List<string> Launchers { get; set; } = [];

    public List<string> PathHints { get; set; } = [];

    public List<string> InstallDirMarkers { get; set; } = [];
}
