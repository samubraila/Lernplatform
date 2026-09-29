using System.Diagnostics;
using System.Reflection;

namespace Lernplattform;

// Startet den eingebauten Node-Server (Lernplattform-Server.exe) im Hintergrund und beendet ihn mit dem Fenster.
static class Server
{
    public static readonly int Port = int.TryParse(Environment.GetEnvironmentVariable("LERN_PORT"), out var p) ? p : 4750;
    public static string Url => $"http://localhost:{Port}/";

    static Process proc;
    static readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(2) };

    public static async Task<bool> PingAsync()
    {
        try { return (await http.GetAsync($"http://127.0.0.1:{Port}/api/info")).IsSuccessStatusCode; } catch { return false; }
    }

    public static async Task StartAsync()
    {
        if (await PingAsync()) return;   // läuft schon (z. B. nach einem Absturz des Fensters)
        var exe = ExtractServer();
        var psi = new ProcessStartInfo(exe, "--no-open") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(exe) };
        psi.Environment["LERN_PORT"] = Port.ToString();
        proc = Process.Start(psi) ?? throw new Exception("Server konnte nicht gestartet werden");
        Native.KillWithThisProcess(proc);
        var until = DateTime.Now.AddSeconds(20);
        while (DateTime.Now < until)
        {
            if (proc.HasExited) throw new Exception($"Server wurde beendet (Code {proc.ExitCode}). Läuft eine andere Lernplattform auf Port {Port}?");
            if (await PingAsync()) return;
            await Task.Delay(150);
        }
        throw new Exception("Server antwortet nicht");
    }

    public static void Stop()
    {
        try { if (proc is { HasExited: false }) proc.Kill(); } catch { }
    }

    // Eingebetteten Server nach %LOCALAPPDATA%\Lernplattform\Server auspacken (nur wenn diese Version noch fehlt)
    static string ExtractServer()
    {
        var asm = Assembly.GetExecutingAssembly();
        using var res = asm.GetManifestResourceStream("server.exe") ?? throw new Exception("In dieser EXE fehlt der Server – bitte mit EXE-bauen.bat neu bauen.");
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lernplattform", "Server");
        Directory.CreateDirectory(dir);
        var name = $"Lernplattform-Server-{asm.ManifestModule.ModuleVersionId:N}.exe";
        var target = Path.Combine(dir, name);
        if (!File.Exists(target) || new FileInfo(target).Length != res.Length)
        {
            var tmp = target + ".tmp";
            using (var f = File.Create(tmp)) res.CopyTo(f);
            File.Move(tmp, target, true);
        }
        // Alte Versionen aufräumen
        foreach (var old in Directory.GetFiles(dir, "Lernplattform-Server-*.exe"))
            if (!string.Equals(old, target, StringComparison.OrdinalIgnoreCase)) try { File.Delete(old); } catch { }
        return target;
    }
}
