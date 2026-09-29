namespace Lernplattform;

static class Program
{
    // Eigene Kennung für die Taskleiste: Das Fenster zählt als "Lernplattform", nicht als Edge
    public const string AppId = "Lernplattform.App";

    [STAThread]
    static void Main()
    {
        Native.SetCurrentProcessExplicitAppUserModelID(AppId);

        // Nur ein Fenster: Beim zweiten Start das vorhandene Fenster nach vorne holen
        using var mutex = new Mutex(true, @"Local\Lernplattform.App", out bool first);
        if (!first) { Native.ActivateOtherInstance(); return; }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}
