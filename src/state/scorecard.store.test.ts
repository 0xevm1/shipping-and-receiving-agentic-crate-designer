import { beforeEach, describe, expect, it } from "vitest";
import { getPart } from "@/domain/catalog";
import { catalogPart, useDesigner } from "./store";

const initial = useDesigner.getState();
const s = () => useDesigner.getState();

describe("ranking", () => {
  beforeEach(() => useDesigner.setState(initial, true));

  it("starts on volume, today's ranking", () => {
    expect(s().ranking).toBe("volume");
  });

  it("re-ranks, resets the layout pick and keeps the choice across edits", () => {
    s().setSettings({ quantity: 40 });
    const byVolume = s().result.design!;
    s().setLayoutKey(s().result.layouts[2].key);
    s().setRanking("cost");
    expect(s().ranking).toBe("cost");
    expect(s().layoutKey).toBeNull();
    expect(s().result.design!.cost.totalUsd).toBeLessThanOrEqual(byVolume.cost.totalUsd);
    s().setSettings({ quantity: 41 });
    expect(s().ranking).toBe("cost");
    s().setStandards({ labour: { rateUsdPerHour: 50 } });
    expect(s().ranking).toBe("cost");
    s().setRanking("volume");
    expect(s().result.design!.layout.key).toBe(s().result.layouts[0].key);
  });

  it("a labour rate change re-costs the design", () => {
    const before = s().result.design!.cost;
    expect(s().setStandards({ labour: { rateUsdPerHour: 70 } })).toBeNull();
    const after = s().result.design!.cost;
    expect(after.labourUsd).toBeCloseTo(before.labourUsd * 2);
    expect(after.totalUsd).toBeGreaterThan(before.totalUsd);
    s().resetStandards();
  });
});

describe("time to design", () => {
  beforeEach(() => useDesigner.setState(initial, true));

  it("runs from the clock start to the first export only", () => {
    expect(s().designStartedAt).toBeNull();
    s().markExported(5000); // before the clock starts: nothing to record
    expect(s().designedInMs).toBeNull();
    s().startDesignClock(1000);
    s().startDesignClock(2000); // already running
    expect(s().designStartedAt).toBe(1000);
    s().markExported(73_000);
    expect(s().designedInMs).toBe(72_000);
    s().markExported(90_000); // later exports don't move it
    expect(s().designedInMs).toBe(72_000);
  });

  it("restarts when a part is loaded", () => {
    s().startDesignClock(1000);
    s().markExported(2000);
    s().setPart(catalogPart(getPart("PART-002")));
    expect(s().designedInMs).toBeNull();
    expect(s().designStartedAt).toBeGreaterThan(1000);
  });
});
