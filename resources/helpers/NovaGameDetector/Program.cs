using System.Text.Json;
using NovaGameDetector.Detection;

namespace NovaGameDetector;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private static async Task<int> Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("Usage: NovaGameDetector.exe --scan | --watch [--interval <seconds>]");
            return 1;
        }

        var service = new GameDetectionService(
            new ProcessScanner(),
            new ForegroundWindowDetector(),
            new KnownGamesLoader(),
            new GameMatcher(new InstallDirectoryResolver()));

        var command = args[0].Trim().ToLowerInvariant();
        return command switch
        {
            "--scan" => await RunScanAsync(service),
            "--watch" => await RunWatchAsync(service, args),
            _ => HandleUnknownCommand(command)
        };
    }

    private static int HandleUnknownCommand(string command)
    {
        Console.Error.WriteLine($"Unknown command: {command}");
        Console.Error.WriteLine("Usage: NovaGameDetector.exe --scan | --watch [--interval <seconds>]");
        return 1;
    }

    private static async Task<int> RunScanAsync(GameDetectionService service)
    {
        var result = await service.ScanAsync();
        var json = JsonSerializer.Serialize(result, JsonOptions);
        Console.Out.WriteLine(json);

        if (!string.IsNullOrWhiteSpace(result.Error))
        {
            Console.Error.WriteLine(result.Error);
        }

        return 0;
    }

    private static async Task<int> RunWatchAsync(GameDetectionService service, IReadOnlyList<string> args)
    {
        var interval = ParseInterval(args);
        string? lastEmittedPayload = null;

        while (true)
        {
            var result = await service.ScanAsync();
            var json = JsonSerializer.Serialize(result, JsonOptions);

            if (!string.Equals(lastEmittedPayload, json, StringComparison.Ordinal))
            {
                Console.Out.WriteLine(json);
                lastEmittedPayload = json;
            }

            if (!string.IsNullOrWhiteSpace(result.Error))
            {
                Console.Error.WriteLine(result.Error);
            }

            await Task.Delay(interval);
        }
    }

    private static TimeSpan ParseInterval(IReadOnlyList<string> args)
    {
        const int defaultSeconds = 2;

        for (var index = 1; index < args.Count - 1; index += 1)
        {
            if (!string.Equals(args[index], "--interval", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (double.TryParse(args[index + 1], out var seconds) && seconds >= 0.5 && seconds <= 120)
            {
                return TimeSpan.FromSeconds(seconds);
            }
        }

        return TimeSpan.FromSeconds(defaultSeconds);
    }
}
