// Turns the CRA build into ONE self-contained file (build/looper.html) that REAPER's
// web server can serve from its reaper_www_root folder.
const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build');
let html = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8');

const read = (ref) => fs.readFileSync(path.join(buildDir, ref.replace(/^\.?\//, '')), 'utf8');

html = html.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);
// inline scripts ignore "defer", so they are moved to the end of <body>
const scripts = [];
html = html.replace(/<script[^>]*\ssrc="([^"]+\.js)"[^>]*><\/script>/g, (_, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script').replace(/\/\/# sourceMappingURL=.*$/m, '');
  scripts.push(`<script>${js}</script>`);
  return '';
});
// NB: a function replacer, because the bundle can contain "$&" / "$'" and those
// would be expanded as replacement patterns and corrupt the JavaScript
html = html.replace('</body>', () => `${scripts.join('')}</body>`);
// icons / manifest are not needed on the iPad
// (the inline data: icons stay, so the iPad gets a favicon and a home screen icon)
html = html.replace(/<link[^>]+rel="(icon|apple-touch-icon|manifest)"[^>]*>/g, (tag) =>
  /href="data:/.test(tag) ? tag : ''
);

const out = path.join(buildDir, 'looper.html');
fs.writeFileSync(out, html);
console.log(`Created ${out} (${Math.round(html.length / 1024)} KB)`);
