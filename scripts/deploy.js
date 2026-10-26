// Copies build/looper.html into REAPER's web root (and the JSFX/Lua into REAPER's folders).
// Default REAPER resource path: %APPDATA%\REAPER (Windows), ~/Library/Application Support/REAPER (macOS).
// Override with: set REAPER_RESOURCE_PATH=C:\path\to\REAPER
const fs = require('fs');
const os = require('os');
const path = require('path');

function resourcePath() {
  if (process.env.REAPER_RESOURCE_PATH) return process.env.REAPER_RESOURCE_PATH;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'REAPER');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'REAPER');
  return path.join(os.homedir(), '.config', 'REAPER');
}

const root = resourcePath();
if (!fs.existsSync(root)) {
  console.error(`REAPER resource folder not found: ${root}\nSet REAPER_RESOURCE_PATH and retry.`);
  process.exit(1);
}

const here = path.join(__dirname, '..');
const copies = [
  [
    fs.existsSync(path.join(here, 'build', 'looper.html'))
      ? path.join(here, 'build', 'looper.html')
      : path.join(here, 'reaper', 'looper.html'), // prebuilt copy
    path.join(root, 'reaper_www_root', 'looper.html'),
  ],
  [path.join(here, 'reaper', 'MyLooper.jsfx'), path.join(root, 'Effects', 'MyLooper', 'MyLooper.jsfx')],
  [path.join(here, 'reaper', 'MyLooper_bridge.lua'), path.join(root, 'Scripts', 'MyLooper', 'MyLooper_bridge.lua')],
];

for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`${path.basename(from)} -> ${to}`);
}
// start the bridge automatically with REAPER (Scripts/__startup.lua)
const startup = path.join(root, 'Scripts', '__startup.lua');
const line = 'dofile(reaper.GetResourcePath() .. "/Scripts/MyLooper/MyLooper_bridge.lua") -- MyLooper';
const current = fs.existsSync(startup) ? fs.readFileSync(startup, 'utf8') : '';
if (!current.includes('MyLooper_bridge.lua')) {
  fs.writeFileSync(startup, current + (current && !current.endsWith('\n') ? '\n' : '') + line + '\n');
  console.log(`Bridge added to ${startup} (starts with REAPER)`);
}

console.log('\nOn the iPad open: http://<PC IP>:8080/looper.html');
