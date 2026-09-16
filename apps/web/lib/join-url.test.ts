import { describe, expect, it } from "vitest";
import { buildJoinUrl, isLoopbackJoinBase, normalizeJoinBase, selectJoinBase } from "./join-url";

describe("join URL selection", () => {
  it("normalizes an HTTP origin and removes unrelated path data", () => {
    expect(normalizeJoinBase(" https://quiz.example.ca/some/path?ignored=1 ")).toBe(
      "https://quiz.example.ca",
    );
    expect(normalizeJoinBase("ftp://quiz.example.ca")).toBeNull();
    expect(normalizeJoinBase("https://user:secret@quiz.example.ca")).toBeNull();
  });

  it("recognizes addresses that cannot be opened from another device", () => {
    expect(isLoopbackJoinBase("http://localhost:8080")).toBe(true);
    expect(isLoopbackJoinBase("http://127.0.0.1:8080")).toBe(true);
    expect(isLoopbackJoinBase("http://[::1]:8080")).toBe(true);
    expect(isLoopbackJoinBase("http://192.168.1.20:8080")).toBe(false);
    expect(isLoopbackJoinBase("https://quiz.example.ca")).toBe(false);
  });

  it("prefers a reachable configured or current origin", () => {
    expect(
      selectJoinBase({
        configured: "http://localhost:8080",
        current: "http://192.168.1.20:8080",
      }),
    ).toBe("http://192.168.1.20:8080");
    expect(
      selectJoinBase({
        configured: "https://quiz.example.ca",
        current: "http://localhost:8080",
      }),
    ).toBe("https://quiz.example.ca");
  });

  it("uses a facilitator override and builds a prefilled join link", () => {
    const base = selectJoinBase({
      configured: "http://localhost:8080",
      current: "http://localhost:8080",
      saved: "http://10.0.0.25:8080",
    });
    expect(buildJoinUrl(base, "0123456")).toBe("http://10.0.0.25:8080/join?code=0123456");
  });
});
