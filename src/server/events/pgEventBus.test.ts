import { describe, expect, it } from "vitest";
import { backoffDelay, describeError } from "./pgEventBus";

describe("listener backoff", () => {
  it("doubles from the initial delay up to the cap, with jitter between half and full", () => {
    expect(backoffDelay(0, 250, 10_000, () => 1)).toBe(250);
    expect(backoffDelay(3, 250, 10_000, () => 1)).toBe(2000);
    expect(backoffDelay(20, 250, 10_000, () => 1)).toBe(10_000);
    expect(backoffDelay(3, 250, 10_000, () => 0)).toBe(1000);
  });
});

describe("describeError", () => {
  it("names an error with an empty message by its code and its nested errors", () => {
    // What Node throws when both ::1 and 127.0.0.1 refuse a connect to `localhost`.
    const refused = (address: string) => Object.assign(new Error(`connect ECONNREFUSED ${address}:5432`), { code: "ECONNREFUSED" });
    const aggregate = Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")], ""), { code: "ECONNREFUSED" });
    expect(describeError(aggregate)).toBe("ECONNREFUSED: connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("keeps a plain message as it is, and copes with non-errors", () => {
    expect(describeError(new Error('password authentication failed for user "crate"'))).toBe('password authentication failed for user "crate"');
    expect(describeError(Object.assign(new Error("write CONNECTION_CLOSED localhost:5432"), { code: "CONNECTION_CLOSED" }))).toBe(
      "write CONNECTION_CLOSED localhost:5432",
    );
    expect(describeError("boom")).toBe("boom");
    expect(describeError(new Error(""))).toBe("Error");
  });
});
