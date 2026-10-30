// Renders the home-screen icons from the app mark (web/icon.svg) with Chromium.
// Usage: node tools/build_icons.cjs   (needs Playwright; outputs web/icons/*.png)
//  - icon-192/512: the rounded mark, for browsers that show the icon as is.
//  - maskable-512: full-bleed square with the mark inside the 80 % safe zone,
//    so Android launchers can crop it to a circle, squircle or square.
//  - apple-touch-icon (180): full-bleed square; iOS rounds the corners itself.
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "/opt/node22/lib/node_modules/playwright");
const OUT = path.join(__dirname, "..", "hatialert", "web", "icons");
const GREEN = "#1d5a42";
const mark = (s) => `<circle cx="15" cy="15" r="${3.2 * s}" fill="#fff"/><circle cx="15" cy="15" r="${7.5 * s}" fill="none" stroke="#fff" stroke-width="${1.8 * s}" stroke-dasharray="${3 * s} ${2.6 * s}"/><circle cx="15" cy="15" r="${11.5 * s}" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="${1.4 * s}"/>`;
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" rx="8" fill="${GREEN}"/>${mark(1)}</svg>`;
// Outer ring radius 11.5 * 0.8 = 9.2 of 15 -> 61 % of the half-width, inside the 40 % radius safe circle (12 of 15).
const square = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30"><rect width="30" height="30" fill="${GREEN}"/>${mark(s)}</svg>`;
const ICONS = [
  ["icon-192.png", 192, rounded], ["icon-512.png", 512, rounded],
  ["maskable-512.png", 512, square(0.8)], ["apple-touch-icon.png", 180, square(0.85)],
];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, px, svg] of ICONS) {
    await p.setViewportSize({ width: px, height: px });
    await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
    await p.screenshot({ path: path.join(OUT, name), omitBackground: true });
    console.log("wrote", name);
  }
  await b.close();
})();
