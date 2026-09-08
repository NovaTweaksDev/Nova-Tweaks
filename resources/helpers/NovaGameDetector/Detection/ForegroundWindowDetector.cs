using System.Runtime.InteropServices;

namespace NovaGameDetector.Detection;

public sealed class ForegroundWindowDetector
{
    public int? TryGetForegroundProcessId()
    {
        try
        {
            var handle = GetForegroundWindow();
            if (handle == IntPtr.Zero)
            {
                return null;
            }

            _ = GetWindowThreadProcessId(handle, out var processId);
            return processId > 0 ? unchecked((int)processId) : null;
        }
        catch
        {
            return null;
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
