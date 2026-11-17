// Copies chosen e2e screenshots into docs/screenshots/. Only docs/screenshots/readme/ is tracked; the other
// folders are git-ignored, so use `git add -f` to commit a shot for a PR. Opt-in: the specs never write
// there, so a normal `bun run e2e` leaves the repo clean. Run the specs first (`bun run e2e`), then:
//
//   bun run e2e:docs-shots                      the default set below
//   bun run e2e:docs-shots <folder> <name>...   named shots into docs/screenshots/<folder>/
//
// A name is a file in e2e/screenshots/ without its .png (`last-design-before-reload`). The run on a phone or
// narrow window adds the project (`layout-closed-summary-mobile-390`).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const FROM = "e2e/screenshots";
const TO = "docs/screenshots";

/** [e2e shot, destination under docs/screenshots] */
const DEFAULT_SET = [
  ["last-design-before-reload", "71-last-design/before-reload"],
  ["last-design-after-reload", "71-last-design/after-reload"],
  ["last-design-custom-before-reload", "71-last-design/custom-before-reload"],
  ["last-design-custom-after-reload", "71-last-design/custom-after-reload"],
  ["idle-autoplay-hover-while-turning", "64-idle-hover/hover-while-turning"],
];

const [folder, ...names] = process.argv.slice(2);
const pairs = folder ? names.map((name) => [name, `${folder}/${name}`]) : DEFAULT_SET;
if (folder && names.length === 0) {
  console.error("usage: bun run e2e:docs-shots [<folder> <name>...]");
  process.exit(2);
}

let missing = 0;
for (const [shot, dest] of pairs) {
  const src = join(FROM, `${shot}.png`);
  const dst = join(TO, `${dest}.png`);
  if (!existsSync(src)) {
    console.error(`missing ${src} (run \`bun run e2e\` first)`);
    missing++;
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`${src} -> ${dst}`);
}
process.exit(missing ? 1 : 0);
