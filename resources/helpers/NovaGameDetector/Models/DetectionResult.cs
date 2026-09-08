namespace NovaGameDetector.Models;

public sealed class DetectionResult
{
    public List<DetectedGame> Games { get; set; } = [];

    public DetectedGame? ActiveGame { get; set; }

    public DateTimeOffset LastUpdatedAt { get; set; }

    public string? Error { get; set; }
}
