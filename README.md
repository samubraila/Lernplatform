# 📚 Lernplattform

Eine Windows-App zum Lernen, die direkt mit deinem Schulordner arbeitet. Notizen, Word-Dateien, PDFs und Tabellen öffnest und bearbeitest du alle in einem Fenster, ohne zwischen Programmen zu wechseln.

Alles bleibt auf deinem Computer. Die App liest und speichert direkt in deinem Ordner (auch in OneDrive), ohne Cloud und ohne Konto.

---

## Funktionen

### 📁 Ordner & Dateien
- Seitenleiste mit allen Ordnern und Dateien deines Lernordners
- Mehrere Lernordner verwalten und schnell zwischen ihnen wechseln
- Suchen in allen Dateien (**Strg+K**)
- Dateien und Ordner anlegen, umbenennen und löschen (gelöschte Dateien landen im Papierkorb)
- **Live-Synchronisierung**: Änderungen, die du außerhalb der App machst, erscheinen sofort
- Dateien in anderen Programmen öffnen (Word, Edge, Editor …) oder im Explorer anzeigen

### 📝 Seiten (Notizen)
- Notizen als Markdown-Dateien (`.md`), bearbeitet wie in Notion
- Überschriften, Listen, Checklisten, Tabellen, Code, Bilder und Emojis
- Formatieren: **Fett** (Strg+B), *Kursiv* (Strg+I), Unterstrichen (Strg+U), Markieren (Strg+Umschalt+H)
- Links (Strg+K): Webseiten öffnen sich im Browser, Links auf Dateien direkt in der App
- Bilder einfach hineinziehen oder einfügen. Sie werden im Ordner `Bilder` gespeichert.

### 📕 PDF
- PDFs anzeigen, Text markieren und kopieren
- **Formulare ausfüllen**: Textfelder, Kästchen, Auswahllisten, Optionsfelder
- Vorhandenen Text ändern oder neuen Text schreiben
- Abdecken, Markieren, Zeichnen und Bilder einfügen (z. B. eine Unterschrift)
- Seiten drehen und löschen, zoomen, Rückgängig (Strg+Z)
- **Links funktionieren:**
  - Webseiten und E-Mail-Adressen öffnen sich im Browser bzw. Mailprogramm
  - Sprünge im Dokument (z. B. im Inhaltsverzeichnis) führen an die richtige Stelle, mit **↩ Zurück**-Knopf
  - Links auf andere Dateien im Lernordner öffnen sich direkt in der App
  - Auch Adressen, die nur als Text im PDF stehen (z. B. `www.beispiel.de`), sind anklickbar

### 📘 Word, 📗 Excel, 📙 PowerPoint
- Word-Dateien (`.docx`) anzeigen und direkt bearbeiten
- Tabellen (`.xlsx`, `.csv`) mit allen Blättern anzeigen
- Präsentationen (`.pptx`) anzeigen

### 🛟 Sicherheit
- Bevor ein Dokument zum ersten Mal geändert wird, legt die App automatisch eine **Sicherungskopie** an (außerhalb von OneDrive)
- Hell- und Dunkelmodus

---

## Starten

| Datei | Wozu |
|---|---|
| `dist\Lernplattform.exe` | **Die App.** Doppelklick genügt, Node.js wird dafür nicht gebraucht. |
| `Lernplattform.vbs` | Nur zum Entwickeln: startet `server.js` und öffnet die Oberfläche in Edge (benötigt Node.js) |
| `Start-mit-Konsole.bat` | Wie oben, aber mit sichtbarem Konsolenfenster, hilfreich zur Fehlersuche |

`Lernplattform.exe` ist ein **eigenes Programm mit eigenem Fenster**:
- eigenes Symbol in der Taskleiste, lässt sich richtig **an die Taskleiste anheften**
- beim Schließen wird alles gespeichert. Bei ungespeicherten PDF- oder Word-Änderungen fragt die App nach.
- Fenstergröße und -position werden gemerkt
- Web-Links öffnen sich im normalen Browser
- ein zweiter Doppelklick holt das offene Fenster nach vorne

Die Oberfläche läuft mit **WebView2**, der Browser-Engine von Edge, die in Windows 10/11 eingebaut ist. Ein eigenes Edge-Fenster bleibt deshalb nicht zurück.

**Voraussetzungen zum Ausführen:** Windows 10/11 mit [.NET Desktop Runtime 8](https://dotnet.microsoft.com/download/dotnet/8.0) oder neuer. Die WebView2 Runtime ist in Windows 11 schon enthalten.

**Einstellungen und Sicherungen**
- Als EXE: `%APPDATA%\Lernplattform` (auch `fenster.json` für die Fensterposition)
- Mit Node.js gestartet: im Projektordner (`einstellungen.json`, `Sicherungen\`)

---

## Für Entwickler

### Voraussetzungen
- Windows 10/11
- [Node.js](https://nodejs.org) (nur zum Entwickeln und Bauen)
- [.NET SDK 8](https://dotnet.microsoft.com/download) oder neuer (nur zum Bauen der EXE)
- Microsoft Edge (für die Tests und den Start über `Lernplattform.vbs`)

Es werden **keine npm-Pakete** zum Ausführen benötigt. Der Server nutzt nur Node-Bordmittel, und die Bibliotheken für die Oberfläche liegen in `public\vendor`.

### Aufbau

```
server.js            Lokaler Server: liest/schreibt im Lernordner, meldet Änderungen live
public/
  index.html         Oberfläche
  app.js             Hauptlogik: Navigation, Dateien, Anzeige der Dokumente
  editor.js          Editor für Seiten (Notizen)
  markdown.js        Markdown lesen und schreiben
  docedit.js         Word- und PDF-Bearbeitung (inkl. PDF-Links)
  style.css          Aussehen
  vendor/            pdf.js, pdf-lib, docx-preview, SheetJS, JSZip, fontkit
desktop/             Programmfenster der EXE (C#, WinForms + WebView2)
  Program.cs         Start, eigene Taskleisten-Kennung, nur ein Fenster
  MainForm.cs        Fenster: Oberfläche anzeigen, Links, Speichern beim Schließen
  Server.cs          Startet den eingebauten Server und beendet ihn mit dem Fenster
tests/run-tests.js   Automatische Tests
tools/build-exe.js   Baut die EXE
```

### Tests

```
Tests-ausfuehren.bat
```
oder `node tests\run-tests.js`

Die Tests legen einen eigenen Testordner an (deine Schuldaten werden **nicht** angefasst) und bedienen die App in einem unsichtbaren Edge-Fenster wie ein Mensch. Der Bericht mit Screenshots landet in `Testbericht\index.html`.

Nützliche Optionen:
- `--only=pdf` führt nur Tests aus, deren Name „pdf“ enthält
- `--exe=dist\Lernplattform.exe` testet die fertige EXE statt `server.js`

### EXE bauen

```
EXE-bauen.bat
```
oder `node tools\build-exe.js`

Das Skript arbeitet in zwei Schritten:
1. Node.js, `server.js` und die komplette Oberfläche werden zu `build\Lernplattform-Server.exe` gepackt.
2. Diese Server-EXE wird in das Programmfenster (`desktop\`) eingebettet. Ergebnis: eine einzige Datei, `dist\Lernplattform.exe`.

Beim Start packt die App den Server einmalig nach `%LOCALAPPDATA%\Lernplattform\Server` aus (der erste Start dauert deshalb ein paar Sekunden länger). Der Server läuft auf `http://localhost:4750` und wird beendet, sobald das Fenster geschlossen wird.

> Läuft die App gerade, lässt sich die EXE nicht überschreiben. Schließe sie vorher, oder benenne die alte EXE um.
>
> `dist\Lernplattform.exe` ist etwa 94 MB groß. GitHub erlaubt höchstens 100 MB pro Datei.
