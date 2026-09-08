using NovaGameDetector.Models;

namespace NovaGameDetector.Detection;

public sealed class GameDetectionService
{
    private readonly ProcessScanner _processScanner;
    private readonly ForegroundWindowDetector _foregroundWindowDetector;
    private readonly KnownGamesLoader _knownGamesLoader;
    private readonly GameMatcher _gameMatcher;
    private IReadOnlyList<KnownGame>? _cachedKnownGames;

    public GameDetectionService(
        ProcessScanner processScanner,
        ForegroundWindowDetector foregroundWindowDetector,
        KnownGamesLoader knownGamesLoader,
        GameMatcher gameMatcher)
    {
        _processScanner = processScanner;
        _foregroundWindowDetector = foregroundWindowDetector;
        _knownGamesLoader = knownGamesLoader;
        _gameMatcher = gameMatcher;
    }

    public Task<DetectionResult> ScanAsync()
    {
        var result = new DetectionResult
        {
            LastUpdatedAt = DateTimeOffset.Now
        };

        try
        {
            var knownGames = LoadKnownGames();
            var runningProcesses = _processScanner.ScanRunningProcesses();
            var foregroundPid = _foregroundWindowDetector.TryGetForegroundProcessId();
            var detectedGames = _gameMatcher.MatchGames(runningProcesses, knownGames, foregroundPid);

            result.Games = detectedGames.ToList();
            result.ActiveGame = result.Games.FirstOrDefault((entry) =>
                string.Equals(entry.State, "active_foreground", StringComparison.OrdinalIgnoreCase));
            result.LastUpdatedAt = DateTimeOffset.Now;
            result.Error = null;
        }
        catch (Exception error)
        {
            result.Games = [];
            result.ActiveGame = null;
            result.LastUpdatedAt = DateTimeOffset.Now;
            result.Error = $"Game detection scan failed: {error.Message}";
        }

        return Task.FromResult(result);
    }

    private IReadOnlyList<KnownGame> LoadKnownGames()
    {
        _cachedKnownGames ??= _knownGamesLoader.LoadKnownGames();
        return _cachedKnownGames;
    }
}
