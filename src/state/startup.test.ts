import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentDesignFile } from "@/lib/currentDesign";
import { beginLoad } from "./loadSequence";
import { createStartup, type StartupDeps } from "./startup";
import { useDesigner } from "./store";
import { useView } from "./viewStore";

const initial = useDesigner.getState();
const viewInitial = useView.getState();
const s = () => useDesigner.getState();

function savedCrate() {
  const design = currentDesignFile(s(), "2026-11-16T12:00:00.000Z")!;
  return { design, tab: "overview" as const, ranking: "cost" as const };
}

function deps(over: Partial<StartupDeps> = {}): StartupDeps {
  return {
    hash: () => "",
    savedDesign: () => null,
    restore: vi.fn(async () => true),
    openShare: vi.fn(async () => {}),
    ...over,
  };
}

describe("startup source", () => {
  beforeEach(() => {
    useDesigner.setState(initial, true);
    useView.setState(viewInitial, true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("runs once however many times it is called (StrictMode mounts twice)", async () => {
    const saved = savedCrate();
    const d = deps({ savedDesign: () => saved });
    const start = createStartup(d);
    const [a, b] = [start(), start()];
    expect(a).toBe(b);
    expect(await a).toBe("last");
    expect(d.restore).toHaveBeenCalledTimes(1);
    expect(d.openShare).not.toHaveBeenCalled();
  });

  it("a share link wins over the saved design, and a second call doesn't restore it over the link", async () => {
    const saved = savedCrate();
    let hash = "#design=abc";
    const d = deps({
      savedDesign: () => saved,
      hash: () => hash,
      // Opening the link removes the hash, as `openShareLink` does.
      openShare: vi.fn(async () => {
        hash = "";
      }),
    });
    const start = createStartup(d);
    expect(await start()).toBe("share");
    expect(await start()).toBe("share");
    expect(d.openShare).toHaveBeenCalledTimes(1);
    expect(d.restore).not.toHaveBeenCalled();
    expect(useView.getState().designStartedAt).not.toBeNull();
  });

  it("holds the scene back while restoring, then releases it", async () => {
    let finish!: (v: boolean) => void;
    const d = deps({ savedDesign: savedCrate, restore: () => new Promise<boolean>((r) => (finish = r)) });
    const done = createStartup(d)();
    expect(useView.getState().restoring).toBe(true);
    finish(true);
    await done;
    expect(useView.getState().restoring).toBe(false);
    expect(useView.getState().designStartedAt).toBeNull();
  });

  it("starts the clock when the last design could not reopen", async () => {
    await createStartup(deps({ savedDesign: savedCrate, restore: async () => false }))();
    expect(useView.getState().designStartedAt).not.toBeNull();
  });

  it("leaves the clock to a load that superseded the restore", async () => {
    const d = deps({
      savedDesign: savedCrate,
      restore: async () => {
        beginLoad();
        return false;
      },
    });
    await createStartup(d)();
    expect(useView.getState().designStartedAt).toBeNull();
  });
});
