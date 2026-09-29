' Startet die Lernplattform unsichtbar im Hintergrund und öffnet das App-Fenster.
Set sh = CreateObject("WScript.Shell")
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
sh.Run """C:\Program Files\nodejs\node.exe"" """ & appDir & "\server.js""", 0, False
