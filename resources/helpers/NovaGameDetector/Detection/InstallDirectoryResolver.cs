using NovaGameDetector.Models;

namespace NovaGameDetector.Detection;

public sealed class InstallDirectoryResolver
{
    private static readonly string[] NestedFolderHints =
    [
        "binaries",
        "bin",
        "win64",
        "win32",
        "x64",
        "x86",
        "shipping",
        "retail",
        "launcher",
        "game",
        "engine"
    ];

    public string? ResolveInstallDirectory(KnownGame knownGame, string? exePath)
    {
        var normalizedExePath = NormalizePath(exePath);
        if (string.IsNullOrWhiteSpace(normalizedExePath))
        {
            return null;
        }

        var exeDirectory = Path.GetDirectoryName(normalizedExePath);
        if (string.IsNullOrWhiteSpace(exeDirectory))
        {
            return null;
        }

        var markerPath = TryResolveByMarker(exeDirectory, knownGame.InstallDirMarkers);
        if (!string.IsNullOrWhiteSpace(markerPath))
        {
            return markerPath;
        }

        var hintedPath = TryResolveByPathHints(exeDirectory, knownGame.PathHints);
        if (!string.IsNullOrWhiteSpace(hintedPath))
        {
            return hintedPath;
        }

        var trimmedNestedPath = TrimNestedRuntimeFolders(exeDirectory);
        return string.IsNullOrWhiteSpace(trimmedNestedPath) ? NormalizePath(exeDirectory) : trimmedNestedPath;
    }

    public bool HasInstallMarkerMatch(KnownGame knownGame, string? path)
    {
        var normalizedPath = (NormalizePath(path) ?? string.Empty).ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(normalizedPath))
        {
            return false;
        }

        foreach (var marker in knownGame.InstallDirMarkers)
        {
            var normalizedMarker = marker?.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(normalizedMarker))
            {
                continue;
            }

            if (normalizedPath.Contains(normalizedMarker, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static string? TryResolveByMarker(string exeDirectory, IEnumerable<string> markers)
    {
        var segments = exeDirectory
            .Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries)
            .ToArray();

        foreach (var marker in markers)
        {
            var normalizedMarker = marker?.Trim();
            if (string.IsNullOrWhiteSpace(normalizedMarker))
            {
                continue;
            }

            for (var index = 0; index < segments.Length; index += 1)
            {
                if (!segments[index].Contains(normalizedMarker, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                return NormalizePath(string.Join(Path.DirectorySeparatorChar, segments.Take(index + 1)));
            }
        }

        return null;
    }

    private static string? TryResolveByPathHints(string exeDirectory, IEnumerable<string> pathHints)
    {
        var normalizedDirectory = NormalizePath(exeDirectory);
        if (string.IsNullOrWhiteSpace(normalizedDirectory))
        {
            return null;
        }

        var normalizedDirectoryLower = normalizedDirectory.ToLowerInvariant();

        foreach (var hint in pathHints)
        {
            var normalizedHint = NormalizeHint(hint);
            if (string.IsNullOrWhiteSpace(normalizedHint))
            {
                continue;
            }

            var index = normalizedDirectoryLower.IndexOf(normalizedHint, StringComparison.OrdinalIgnoreCase);
            if (index < 0)
            {
                continue;
            }

            var endIndex = index + normalizedHint.Length;
            var candidate = normalizedDirectory[..endIndex].TrimEnd(Path.DirectorySeparatorChar);
            var resolved = NormalizePath(candidate);
            if (!string.IsNullOrWhiteSpace(resolved))
            {
                return resolved;
            }
        }

        return null;
    }

    private static string TrimNestedRuntimeFolders(string exeDirectory)
    {
        var directoryInfo = new DirectoryInfo(exeDirectory);
        var current = directoryInfo;

        while (current.Parent is not null)
        {
            var normalizedName = current.Name.Trim().ToLowerInvariant();
            if (!NestedFolderHints.Contains(normalizedName))
            {
                break;
            }

            current = current.Parent;
        }

        return NormalizePath(current.FullName) ?? string.Empty;
    }

    private static string NormalizeHint(string? value)
    {
        var candidate = (value ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return string.Empty;
        }

        return candidate
            .Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar)
            .ToLowerInvariant();
    }

    private static string? NormalizePath(string? value)
    {
        var candidate = Environment.ExpandEnvironmentVariables((value ?? string.Empty).Trim());
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return null;
        }

        try
        {
            candidate = Path.GetFullPath(candidate);
        }
        catch
        {
            // Keep best-effort path when full path normalization fails.
        }

        return candidate.Replace('/', '\\').TrimEnd(Path.DirectorySeparatorChar);
    }
}
