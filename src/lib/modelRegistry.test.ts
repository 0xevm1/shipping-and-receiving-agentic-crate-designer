import { Group, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { createModelRegistry } from "./modelRegistry";

/** A registry on fakes: URLs are counted, scenes are plain groups whose disposal is recorded. */
function fakes() {
  const log: string[] = [];
  let n = 0;
  const loads: { url: string; resolve: (s: Object3D) => void; reject: (e: Error) => void }[] = [];
  const registry = createModelRegistry({
    createUrl: () => `blob:m${++n}`,
    revokeUrl: (url) => log.push(`revoke ${url}`),
    loadScene: (url) =>
      new Promise<Object3D>((resolve, reject) => {
        loads.push({ url, resolve, reject });
      }),
    disposeScene: (scene) => log.push(`dispose ${scene.name}`),
  });
  const scene = (name: string) => Object.assign(new Group(), { name });
  /** Loads the model's scene and finishes the parse. */
  const parsed = async (url: string, name = url) => {
    const p = registry.scene(url);
    loads.find((l) => l.url === url)!.resolve(scene(name));
    return p;
  };
  return { registry, log, loads, scene, parsed };
}
const blob = () => new Blob(["glb"]);

describe("model registry", () => {
  it("frees a model once, when its last holder lets go: URL revoked, scene disposed", async () => {
    const { registry, log, parsed } = fakes();
    const { url, hold: loader } = registry.adopt(blob());
    const store = registry.acquire(url);
    await parsed(url, "m1");

    loader.release();
    expect(log).toEqual([]);
    store.release();
    expect(log).toEqual(["dispose m1", "revoke blob:m1"]);
    store.release();
    loader.release();
    expect(log).toHaveLength(2);
    expect(registry.size()).toBe(0);
  });

  it("frees nothing while any holder remains, in whatever order they release", async () => {
    const { registry, log, parsed } = fakes();
    const { url, hold } = registry.adopt(blob());
    const holds = [hold, registry.acquire(url), registry.acquire(url)];
    await parsed(url);
    for (const h of [holds[1], holds[0]]) h.release();
    expect(log).toEqual([]);
    holds[2].release();
    expect(log).toEqual(["dispose blob:m1", "revoke blob:m1"]);
  });

  it("an extra release of one hold does not release another's", () => {
    const { registry, log } = fakes();
    const { url, hold } = registry.adopt(blob());
    const other = registry.acquire(url);
    hold.release();
    hold.release();
    hold.release();
    expect(log).toEqual([]);
    other.release();
    expect(log).toEqual(["revoke blob:m1"]);
  });

  it("a superseded load's model, never shown, is freed when its loader lets go", async () => {
    const { registry, log, parsed } = fakes();
    const first = registry.adopt(blob());
    const second = registry.adopt(blob());
    await parsed(first.url);
    // The second load won: the first outcome is dropped.
    first.hold.release();
    expect(log).toEqual(["dispose blob:m1", "revoke blob:m1"]);
    expect(registry.blob(second.url)).not.toBeNull();
  });

  it("a model without a parse is revoked without disposing anything", () => {
    const { registry, log } = fakes();
    registry.adopt(blob()).hold.release();
    expect(log).toEqual(["revoke blob:m1"]);
  });

  it("parses once however many ask, and shares the scene", async () => {
    const { registry, loads, parsed } = fakes();
    const { url } = registry.adopt(blob());
    const a = registry.scene(url);
    const b = registry.scene(url);
    expect(a).toBe(b);
    loads[0].resolve(new Group());
    expect(await a).toBe(await b);
    await parsed(url).catch(() => {});
    expect(loads).toHaveLength(1);
  });

  it("waits for a parse in flight before revoking, then disposes what it made", async () => {
    const { registry, log, loads, scene } = fakes();
    const { url, hold } = registry.adopt(blob());
    const pending = registry.scene(url);
    hold.release();
    expect(log).toEqual([]);
    loads[0].resolve(scene("late"));
    await pending;
    await Promise.resolve();
    expect(log).toEqual(["dispose late", "revoke blob:m1"]);
  });

  it("a failed parse is revoked with the model and can be asked for again", async () => {
    const { registry, log, loads, scene } = fakes();
    const { url, hold } = registry.adopt(blob());
    const failing = registry.scene(url);
    loads[0].reject(new Error("bad"));
    await expect(failing).rejects.toThrow("bad");
    const again = registry.scene(url);
    expect(loads).toHaveLength(2);
    loads[1].resolve(scene("ok"));
    await again;
    hold.release();
    expect(log).toEqual(["dispose ok", "revoke blob:m1"]);
  });

  it("holds the file's bytes and the data derived from the model until it is freed", () => {
    const { registry } = fakes();
    const file = blob();
    const { url, hold } = registry.adopt(file);
    expect(registry.blob(url)).toBe(file);
    const profiles = registry.memo<string>(url);
    profiles.set("m/z", "profile");
    expect(registry.memo<string>(url).get("m/z")).toBe("profile");
    hold.release();
    expect(registry.blob(url)).toBeNull();
    expect(profiles.size).toBe(0);
    expect(registry.memo<string>(url).has("m/z")).toBe(false);
  });

  it("a freed model has no scene to hand out, and a hold on it is nothing", async () => {
    const { registry, log } = fakes();
    const { url, hold } = registry.adopt(blob());
    hold.release();
    await expect(registry.scene(url)).rejects.toThrow("released");
    registry.acquire(url).release();
    expect(log).toEqual(["revoke blob:m1"]);
  });

  it("never frees a bundled model: it is parsed once and stays cached", async () => {
    const { registry, log, loads, scene } = fakes();
    const url = "/parts/PART-001.glb";
    const hold = registry.acquire(url);
    const first = registry.scene(url);
    loads[0].resolve(scene("bundled"));
    await first;
    registry.memo<string>(url).set("m/z", "profile");
    hold.release();
    registry.acquire(url).release();
    expect(await registry.scene(url)).toBe(await first);
    expect(registry.memo<string>(url).get("m/z")).toBe("profile");
    expect(loads).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it("each model is freed on its own: switching parts keeps nothing of the old one", async () => {
    const { registry, log, parsed } = fakes();
    const live: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { url, hold } = registry.adopt(blob());
      const store = registry.acquire(url);
      await parsed(url);
      hold.release();
      live.push(url);
      // The part is replaced: the next one is acquired before this one is let go, in the real flow.
      if (i < 9) store.release();
    }
    expect(registry.size()).toBe(1);
    expect(log.filter((l) => l.startsWith("revoke"))).toHaveLength(9);
    expect(log.filter((l) => l.startsWith("dispose"))).toHaveLength(9);
  });
});
