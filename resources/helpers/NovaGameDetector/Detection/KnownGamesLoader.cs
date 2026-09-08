using System.Text.Json;
using NovaGameDetector.Models;

namespace NovaGameDetector.Detection;

public sealed class KnownGamesLoader
{
    private readonly JsonSerializerOptions _serializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public IReadOnlyList<KnownGame> LoadKnownGames(string? overridePath = null)
    {
        var path = ResolveKnownGamesPath(overridePath);
        var payload = File.ReadAllText(path);
        var parsed = JsonSerializer.Deserialize<KnownGamesPayload>(payload, _serializerOptions) ?? new KnownGamesPayload();

        return parsed.Games
            .Where((entry) => !string.IsNullOrWhiteSpace(entry.Id))
            .Select(NormalizeEntry)
            .ToList();
    }

    private static string ResolveKnownGamesPath(string? overridePath)
    {
        var candidates = new List<string>();

        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            candidates.Add(overridePath);
        }

        candidates.Add(Path.Combine(AppContext.BaseDirectory, "known-games.json"));
        candidates.Add(Path.Combine(AppContext.BaseDirectory, "resources", "helpers", "NovaGameDetector", "known-games.json"));
        candidates.Add(Path.Combine(Directory.GetCurrentDirectory(), "resources", "helpers", "NovaGameDetector", "known-games.json"));

        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate))
            {
                continue;
            }

            var fullPath = Path.GetFullPath(candidate);
            if (File.Exists(fullPath))
            {
                return fullPath;
            }
        }

        throw new FileNotFoundException("Unable to locate known-games.json for NovaGameDetector.");
    }

    private static KnownGame NormalizeEntry(KnownGame raw)
    {
        static List<string> NormalizeList(IEnumerable<string>? values)
        {
            return (values ?? Array.Empty<string>())
                .Select((entry) => (entry ?? string.Empty).Trim())
                .Where((entry) => !string.IsNullOrWhiteSpace(entry))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        return new KnownGame
        {
            Id = (raw.Id ?? string.Empty).Trim(),
            DisplayName = string.IsNullOrWhiteSpace(raw.DisplayName) ? (raw.Id ?? string.Empty).Trim() : raw.DisplayName.Trim(),
            ProcessNames = NormalizeList(raw.ProcessNames),
            ExcludeProcesses = NormalizeList(raw.ExcludeProcesses),
            Launchers = NormalizeList(raw.Launchers),
            PathHints = NormalizeList(raw.PathHints),
            InstallDirMarkers = NormalizeList(raw.InstallDirMarkers)
        };
    }

    private sealed class KnownGamesPayload
    {
        public List<KnownGame> Games { get; set; } = [];
    }
}
