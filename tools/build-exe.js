// Baut dist\Lernplattform.exe: eigenes Programmfenster (desktop\, WebView2) mit eingebautem Server (Node + server.js + public\).
//   Start:  node tools\build-exe.js      (oder EXE-bauen.bat)
// Ablauf: SEA-Blob erzeugen → node.exe kopieren → Symbol/Versionsinfo setzen → Blob einfügen → ohne Konsolenfenster starten
//         = build\Lernplattform-Server.exe → mit dotnet in das Programmfenster einbetten → dist\Lernplattform.exe.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const BUILD = path.join(APP, 'build');
const DIST = path.join(APP, 'dist');
const EXE = path.join(BUILD, 'Lernplattform-Server.exe');
const APP_EXE = path.join(DIST, 'Lernplattform.exe');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const step = msg => console.log('› ' + msg);

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(abs, base) : [path.relative(base, abs).split(path.sep).join('/')];
  });
}

fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1) Hilfsprogramme (nur zum Bauen, landen nicht in der EXE)
if (!fs.existsSync(path.join(BUILD, 'node_modules', 'postject')) || !fs.existsSync(path.join(BUILD, 'node_modules', 'rcedit'))) {
  step('Lade Bau-Werkzeuge (postject, rcedit) …');
  fs.writeFileSync(path.join(BUILD, 'package.json'), JSON.stringify({ name: 'lernplattform-build', private: true }));
  execFileSync(NPM, ['install', '--no-audit', '--no-fund', '--silent', 'postject@1.0.0-alpha.6', 'rcedit@4.0.1'], { cwd: BUILD, stdio: 'inherit', shell: true });
}

// 2) SEA-Konfiguration mit allen Dateien der Oberfläche als eingebettete Assets
const files = listFiles(path.join(APP, 'public'));
const assets = Object.fromEntries(files.map(f => ['public/' + f, path.join(APP, 'public', f)]));
const seaConfig = { main: path.join(APP, 'server.js'), output: path.join(BUILD, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets };
fs.writeFileSync(path.join(BUILD, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
step(`Packe server.js + ${files.length} Dateien der Oberfläche …`);
execFileSync(process.execPath, ['--experimental-sea-config', path.join(BUILD, 'sea-config.json')], { stdio: 'inherit' });

// 3) node.exe kopieren und Symbol + Versionsinfo setzen
step('Erzeuge Lernplattform.exe …');
try { fs.rmSync(EXE, { force: true }); } catch (e) { throw new Error('Lernplattform-Server.exe ist noch in Benutzung (' + e.message + ')'); }
fs.copyFileSync(process.execPath, EXE);
const rcedit = path.join(BUILD, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
execFileSync(rcedit, [EXE,
  '--set-icon', path.join(APP, 'lernplattform.ico'),
  '--set-version-string', 'FileDescription', 'Lernplattform',
  '--set-version-string', 'ProductName', 'Lernplattform',
  '--set-version-string', 'CompanyName', 'Lernplattform',
  '--set-version-string', 'OriginalFilename', 'Lernplattform.exe',
  '--set-version-string', 'InternalName', 'Lernplattform',
  '--set-version-string', 'LegalCopyright', 'Eigene App',
  '--set-file-version', '1.0.0', '--set-product-version', '1.0.0'], { stdio: 'inherit' });

// 4) Programm einfügen
step('Füge das Programm in die EXE ein …');
execFileSync(process.execPath, [path.join(BUILD, 'node_modules', 'postject', 'dist', 'cli.js'), EXE, 'NODE_SEA_BLOB', path.join(BUILD, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });

// 5) Als Fenster-Programm markieren (kein schwarzes Konsolenfenster)
const buf = fs.readFileSync(EXE);
const pe = buf.readUInt32LE(0x3c);
if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Keine gültige EXE');
buf.writeUInt16LE(2, pe + 24 + 68);   // IMAGE_SUBSYSTEM_WINDOWS_GUI
fs.writeFileSync(EXE, buf);

// 6) Programmfenster bauen (C# + WebView2), der Server steckt darin
step('Baue das Programmfenster (dotnet) …');
const OUT = path.join(BUILD, 'desktop');
fs.rmSync(OUT, { recursive: true, force: true });
execFileSync('dotnet', ['publish', path.join(APP, 'desktop', 'Lernplattform.Desktop.csproj'), '-c', 'Release', '-o', OUT, '--nologo', '-v', 'q'], { stdio: 'inherit' });
try { fs.rmSync(APP_EXE, { force: true }); } catch (e) { throw new Error('Lernplattform.exe läuft noch – bitte zuerst schließen (' + e.message + ')'); }
fs.copyFileSync(path.join(OUT, 'Lernplattform.exe'), APP_EXE);

const mb = (fs.statSync(APP_EXE).size / 1048576).toFixed(0);
console.log(`\n✓ Fertig: ${APP_EXE} (${mb} MB)`);
