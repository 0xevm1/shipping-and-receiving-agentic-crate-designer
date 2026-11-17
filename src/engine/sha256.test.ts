import { describe, expect, it } from "vitest";
import { sha256Hex, sha256Text } from "./sha256";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("sha256", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Text("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Text("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("hashes UTF-8, not UTF-16", () => {
    expect(sha256Text("×")).toBe(sha256Hex(new Uint8Array([0xc3, 0x97])));
  });

  it("agrees with Web Crypto at every padding boundary", async () => {
    for (let n = 0; n < 200; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff);
      expect(sha256Hex(bytes), `${n} bytes`).toBe(hex(await crypto.subtle.digest("SHA-256", bytes)));
    }
  });
});
