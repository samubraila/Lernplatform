using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace Lernplattform;

// Das Programmfenster: zeigt die Oberfläche mit WebView2 (Edge-Engine) – aber als eigene App mit eigenem Symbol.
class MainForm : Form
{
    static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Lernplattform");
    static readonly string LocalDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lernplattform");
    static readonly string StateFile = Path.Combine(DataDir, "fenster.json");

    readonly WebView2 web = new() { Dock = DockStyle.Fill };
    bool dark = SystemIsDark();
    bool mayClose, closing;
    TaskCompletionSource<string> reply;

    public MainForm()
    {
        Text = "Lernplattform";
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!);
        MinimumSize = new Size(640, 420);
        ApplyColors();
        LoadWindowState();
        Controls.Add(web);
        Load += async (_, _) => await StartAsync();
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Native.SetDarkTitleBar(Handle, dark); }

    void ApplyColors()
    {
        BackColor = dark ? Color.FromArgb(25, 25, 25) : Color.White;
        web.DefaultBackgroundColor = BackColor;
        if (IsHandleCreated) Native.SetDarkTitleBar(Handle, dark);
    }

    async Task StartAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(LocalDir, "WebView2"));
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this, "Für die Lernplattform wird die „Microsoft Edge WebView2 Runtime“ benötigt.\n\nSie wird jetzt im Browser zum Herunterladen geöffnet.", "Lernplattform", MessageBoxButtons.OK, MessageBoxIcon.Information);
            OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
            mayClose = true; Close(); return;
        }

        var core = web.CoreWebView2;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;   // keine Browser-Kürzel (Strg+P, F5 …); Kopieren/Einfügen geht weiter
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        // Links nach außen (Webseiten, E-Mail) im normalen Browser/Mailprogramm öffnen
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (IsOwn(e.Uri)) return;
            e.Cancel = true; OpenExternal(e.Uri);
        };
        core.PermissionRequested += (_, e) => { if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead) e.State = CoreWebView2PermissionState.Allow; };
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) || core.DocumentTitle.StartsWith("data:") ? "Lernplattform" : core.DocumentTitle;
        core.ProcessFailed += (_, e) => { if (e.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) core.Reload(); };
        core.WebMessageReceived += OnMessage;

        core.NavigateToString(Page("📚", "Lernplattform wird gestartet …", ""));
        try
        {
            await Server.StartAsync();
            core.Navigate(Server.Url);
        }
        catch (Exception ex)
        {
            core.NavigateToString(Page("⚠️", "Die Lernplattform konnte nicht starten", ex.Message));
        }
    }

    static bool IsOwn(string uri) =>
        uri.StartsWith(Server.Url, StringComparison.OrdinalIgnoreCase) || uri.StartsWith("data:") || uri.StartsWith("about:");

    static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
    }

    void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var m = doc.RootElement;
            switch (m.GetProperty("type").GetString())
            {
                case "theme": dark = m.GetProperty("dark").GetBoolean(); ApplyColors(); break;
                case "reply": reply?.TrySetResult(m.GetProperty("value").GetString()); break;
            }
        }
        catch { }
    }

    // Fragt die Oberfläche (window.__lern.<fn>) und wartet auf die Antwort
    async Task<string> AskPage(string fn, int timeoutMs)
    {
        if (web.CoreWebView2 == null) return null;
        reply = new TaskCompletionSource<string>();
        try
        {
            await web.CoreWebView2.ExecuteScriptAsync($$"""
                (async () => { let r = 'ok';
                  try { if (window.__lern && __lern.{{fn}}) r = (await __lern.{{fn}}()) || 'ok'; } catch (e) { r = 'error'; }
                  chrome.webview.postMessage({ type: 'reply', value: String(r) }); })()
                """);
        }
        catch { return null; }
        var done = await Task.WhenAny(reply.Task, Task.Delay(timeoutMs));
        return done == reply.Task ? reply.Task.Result : null;
    }

    // Vor dem Schließen: Notizen fertig speichern, bei ungespeicherten PDF/Word-Änderungen nachfragen
    protected override async void OnFormClosing(FormClosingEventArgs e)
    {
        if (mayClose || e.CloseReason == CloseReason.WindowsShutDown) { SaveWindowState(); Server.Stop(); base.OnFormClosing(e); return; }
        e.Cancel = true;
        if (closing) return;
        closing = true;
        try
        {
            var state = await AskPage("beforeClose", 5000);
            if (state == "dirty")
            {
                var r = MessageBox.Show(this, "Das geöffnete Dokument hat ungespeicherte Änderungen.\n\nVor dem Schließen speichern?", "Lernplattform", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
                if (r == DialogResult.Cancel) return;
                if (r == DialogResult.Yes && await AskPage("saveBin", 60000) != "ok")
                {
                    MessageBox.Show(this, "Speichern hat nicht geklappt. Das Fenster bleibt offen.", "Lernplattform", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }
            }
            mayClose = true;
            BeginInvoke(Close);
        }
        finally { closing = false; }
    }

    // ---- Fenstergröße und -position merken ----
    record WindowState_(int X, int Y, int W, int H, bool Max);

    void LoadWindowState()
    {
        // Erster Start: 90 % des Bildschirms, mittig
        var wa = Screen.PrimaryScreen!.WorkingArea;
        StartPosition = FormStartPosition.Manual;
        Bounds = new Rectangle(wa.X + wa.Width / 20, wa.Y + wa.Height / 20, wa.Width * 9 / 10, wa.Height * 9 / 10);
        try
        {
            var s = JsonSerializer.Deserialize<WindowState_>(File.ReadAllText(StateFile));
            var r = new Rectangle(s.X, s.Y, s.W, s.H);
            if (s.W >= 400 && s.H >= 300 && Screen.AllScreens.Any(sc => sc.WorkingArea.IntersectsWith(r)))
            {
                Bounds = r;
                if (s.Max) WindowState = FormWindowState.Maximized;
            }
        }
        catch { }
    }

    void SaveWindowState()
    {
        try
        {
            var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(StateFile, JsonSerializer.Serialize(new WindowState_(b.X, b.Y, b.Width, b.Height, WindowState == FormWindowState.Maximized)));
        }
        catch { }
    }

    static bool SystemIsDark()
    {
        try { return Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is 0; }
        catch { return false; }
    }

    static string Page(string icon, string title, string detail) => $$"""
        <!doctype html><meta charset="utf-8"><style>
          :root { color-scheme: light dark; }
          body { margin: 0; height: 100vh; display: grid; place-content: center; text-align: center; font: 15px "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
          .i { font-size: 48px; } h1 { font-size: 18px; font-weight: 600; margin: 12px 0 6px; } p { opacity: .7; max-width: 480px; }
        </style><div class="i">{{icon}}</div><h1>{{System.Net.WebUtility.HtmlEncode(title)}}</h1><p>{{System.Net.WebUtility.HtmlEncode(detail)}}</p>
        """;
}
