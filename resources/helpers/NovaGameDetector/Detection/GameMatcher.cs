using NovaGameDetector.Models;

namespace NovaGameDetector.Detection;

public sealed class GameMatcher
{
    private readonly InstallDirectoryResolver _installDirectoryResolver;

    public GameMatcher(InstallDirectoryResolver installDirectoryResolver)
    {
        _installDirectoryResolver = installDirectoryResolver;
    }

    public IReadOnlyList<DetectedGame> MatchGames(
        IReadOnlyList<RunningProcessInfo> runningProcesses,
        IReadOnlyList<KnownGame> knownGames,
        int? foregroundPid)
    {
        var detections = new List<DetectedGame>();
        var now = DateTimeOffset.Now;

        foreach (var knownGame in knownGames)
        {
            var processNames = ToTokenSet(knownGame.ProcessNames);
            if (processNames.Count == 0)
            {
                continue;
            }

            var excludeNames = ToTokenSet(knownGame.ExcludeProcesses);
            var launcherNames = ToTokenSet(knownGame.Launchers);
            var bestMatch = SelectBestProcessMatch(runningProcesses, knownGame, processNames, excludeNames, launcherNames, foregroundPid, now);

            if (bestMatch is not null)
            {
                detections.Add(bestMatch);
            }
        }

        return detections
            .OrderByDescending((entry) => string.Equals(entry.State, "active_foreground", StringComparison.Ordinal))
            .ThenByDescending((entry) => entry.Confidence)
            .ThenBy((entry) => entry.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private DetectedGame? SelectBestProcessMatch(
        IReadOnlyList<RunningProcessInfo> runningProcesses,
        KnownGame knownGame,
        HashSet<string> processNames,
        HashSet<string> excludeNames,
        HashSet<string> launcherNames,
        int? foregroundPid,
        DateTimeOffset now)
    {
        DetectedGame? bestDetection = null;

        foreach (var process in runningProcesses)
        {
            var normalizedProcessName = NormalizeProcessToken(process.ProcessName);
            if (string.IsNullOrWhiteSpace(normalizedProcessName))
            {
                continue;
            }

            if (excludeNames.Contains(normalizedProcessName))
            {
                continue;
            }

            if (!processNames.Contains(normalizedProcessName))
            {
                continue;
            }

            if (launcherNames.Contains(normalizedProcessName))
            {
                continue;
            }

            if (IsSystemPath(process.ExePath))
            {
                continue;
            }

            var reasons = new List<string>
            {
                "Known game process matched"
            };

            var confidence = 50;

            if (PathHintMatched(process.ExePath, knownGame.PathHints))
            {
                confidence += 30;
                reasons.Add("Executable path matched known game directory");
            }

            var installDir = _installDirectoryResolver.ResolveInstallDirectory(knownGame, process.ExePath);
            if (_installDirectoryResolver.HasInstallMarkerMatch(knownGame, installDir ?? process.ExePath))
            {
                confidence += 10;
                reasons.Add("Install directory marker matched");
            }

            var isForeground = foregroundPid.HasValue && foregroundPid.Value == process.Pid;
            if (isForeground)
            {
                confidence += 20;
                reasons.Add("Game is currently foreground process");
            }

            if (confidence < 70)
            {
                continue;
            }

            var launcher = ResolveRunningLauncherName(runningProcesses, launcherNames);
            var detectedGame = new DetectedGame
            {
                Id = knownGame.Id,
                DisplayName = knownGame.DisplayName,
                ProcessName = process.ProcessName,
                Pid = process.Pid,
                ExePath = process.ExePath ?? string.Empty,
                InstallDir = installDir,
                Launcher = launcher,
                State = isForeground ? "active_foreground" : "running_background",
                Confidence = Math.Clamp(confidence, 0, 100),
                Reasons = reasons,
                DetectedAt = now,
                LastForegroundAt = isForeground ? now : null
            };

            if (bestDetection is null || detectedGame.Confidence > bestDetection.Confidence)
            {
                bestDetection = detectedGame;
            }
        }

        return bestDetection;
    }

    private static string? ResolveRunningLauncherName(IReadOnlyList<RunningProcessInfo> runningProcesses, HashSet<string> launcherNames)
    {
        if (launcherNames.Count == 0)
        {
            return null;
        }

        foreach (var process in runningProcesses)
        {
            var normalized = NormalizeProcessToken(process.ProcessName);
            if (launcherNames.Contains(normalized))
            {
                return process.ProcessName;
            }
        }

        return null;
    }

    private static bool PathHintMatched(string? executablePath, IEnumerable<string> hints)
    {
        var normalizedPath = NormalizePathForComparison(executablePath);
        if (string.IsNullOrWhiteSpace(normalizedPath))
        {
            return false;
        }

        foreach (var hint in hints)
        {
            var normalizedHint = NormalizePathForComparison(hint);
            if (string.IsNullOrWhiteSpace(normalizedHint))
            {
                continue;
            }

            if (normalizedPath.Contains(normalizedHint, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsSystemPath(string? executablePath)
    {
        var normalizedPath = NormalizePathForComparison(executablePath);
        return normalizedPath.Contains("\\windows\\system32\\", StringComparison.OrdinalIgnoreCase);
    }

    private static HashSet<string> ToTokenSet(IEnumerable<string> values)
    {
        return values
            .Select(NormalizeProcessToken)
            .Where((entry) => !string.IsNullOrWhiteSpace(entry))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static string NormalizeProcessToken(string? value)
    {
        var candidate = Path.GetFileName((value ?? string.Empty).Trim()).ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return string.Empty;
        }

        if (!candidate.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !candidate.Contains('.'))
        {
            return $"{candidate}.exe";
        }

        return candidate;
    }

    private static string NormalizePathForComparison(string? value)
    {
        return (value ?? string.Empty)
            .Trim()
            .Replace('/', '\\')
            .ToLowerInvariant();
    }
}
