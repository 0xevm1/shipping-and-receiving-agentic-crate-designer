import { expect, test } from "@playwright/test";

/**
 * App icons and the web manifest (#58). Plain HTTP checks against the production server, so no
 * scene or WebGL is involved.
 */

const ICONS = [
  { path: "/favicon.ico", type: /^image\/(x-icon|vnd\.microsoft\.icon)/ },
  { path: "/icon.svg", type: /^image\/svg\+xml/ },
  { path: "/icon1.png", type: /^image\/png/ },
  { path: "/apple-icon.png", type: /^image\/png/ },
];

test.describe("app icons", () => {
  for (const { path, type } of ICONS) {
    test(`${path} is served with the right content type`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(type);
      expect((await res.body()).byteLength).toBeGreaterThan(0);
    });
  }

  test("the icon is the Crate Designer mark, not the Next.js default", async ({ request }) => {
    const svg = await (await request.get("/icon.svg")).text();
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain("#d9a938");
    expect(svg).toContain("White gear with blue and gold crate");
  });

  test("the manifest names the app and its icons resolve", async ({ request }) => {
    const res = await request.get("/site.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.name).toBe("Crate Designer");
    expect(manifest.start_url).toBe("/");
    expect(manifest.theme_color).toBe("#002548");
    const srcs = manifest.icons.map((icon: { src: string }) => icon.src);
    expect(srcs).toEqual(["/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]);
    for (const src of srcs) {
      const icon = await request.get(src);
      expect(icon.status(), src).toBe(200);
      expect(icon.headers()["content-type"], src).toMatch(/^image\/png/);
    }
  });

  test("the head links the icons and the manifest", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(html).toContain("<title>Crate Designer</title>");
    expect(html).toMatch(/<link rel="manifest" href="\/site\.webmanifest"/);
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.ico[^"]*"/);
    expect(html).toMatch(/<link rel="icon" href="\/icon\.svg[^"]*"[^>]*type="image\/svg\+xml"/);
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon\.png[^"]*"[^>]*sizes="180x180"/);
  });
});
