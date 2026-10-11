// Bundles src/ into the files the Python server serves (hatialert/web/).
// The outputs are committed, so running the app never needs Node.
//   node build.mjs          build once
//   node build.mjs --watch  rebuild on change
import * as esbuild from "esbuild";

const WEB = "../hatialert/web/";
const banner = (src) => `/* GENERATED from web-ts/${src} by \`npm run build\` in web-ts/. Do not edit here: edit the TypeScript there. */`;
const common = {
  bundle: true,
  format: "iife",
  // Older Android phones: ES2019 output, so ?. and ?? (ES2020) are lowered
  // too (Chrome 73+ / Safari 12.1+ class engines).
  target: "es2019",
  charset: "utf8",
  legalComments: "none",
  logLevel: "info",
};
const builds = [
  { entryPoints: ["src/main.ts"], outfile: WEB + "app.js", banner: { js: banner("src/main.ts") } },
  { entryPoints: ["src/i18n/nagamese-entry.ts"], outfile: WEB + "nagamese.js", banner: { js: banner("src/i18n/nagamese.ts") } },
  { entryPoints: ["src/sw.ts"], outfile: WEB + "sw.js", banner: { js: banner("src/sw.ts") } },
];

if (process.argv.includes("--watch")) {
  for (const b of builds) await (await esbuild.context({ ...common, ...b })).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
}
