import { beforeEach, describe, expect, it } from "vitest";
import { useDesigner } from "./store";

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
