import { sessionFor } from "@apex/config";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { sessionIntervals, sessionState } from "../src/sessions.js";

const et = (iso: string) => DateTime.fromISO(iso, { zone: "America/New_York" }).toMillis();
const nvda = sessionFor("NVDA-USD")!;
const xau = sessionFor("XAU-USD")!;

describe("US equity regular session (NYSE calendar)", () => {
  it("is open Thu 2026-10-22 15:00 ET, closes 16:00", () => {
    const s = sessionState(nvda, et("2026-10-22T15:00"));
    expect(s.underlying).toBe("open");
    expect(s.nextClose).toBe(et("2026-10-22T16:00"));
    expect(s.nextOpen).toBe(et("2026-10-23T09:30"));
  });

  it("is closed after the close; next open is the next weekday 09:30", () => {
    const s = sessionState(nvda, et("2026-10-22T16:00"));
    expect(s.underlying).toBe("closed");
    expect(s.nextOpen).toBe(et("2026-10-23T09:30"));
  });

  it("weekend: Saturday → Monday 09:30", () => {
    const s = sessionState(nvda, et("2026-10-24T12:00"));
    expect(s.underlying).toBe("closed");
    expect(s.nextOpen).toBe(et("2026-10-26T09:30"));
  });

  it("Thanksgiving 2026-11-26 closed; Fri 11-27 early close 13:00", () => {
    const s = sessionState(nvda, et("2026-11-26T11:00"));
    expect(s.underlying).toBe("closed");
    expect(s.nextOpen).toBe(et("2026-11-27T09:30"));
    expect(s.nextClose).toBe(et("2026-11-27T13:00"));
    expect(sessionState(nvda, et("2026-11-27T13:30")).underlying).toBe("closed");
  });

  it("Christmas: 12-24 closes 13:00, 12-25 closed, reopens Mon 12-28", () => {
    expect(sessionState(nvda, et("2026-12-24T12:59")).nextClose).toBe(et("2026-12-24T13:00"));
    const s = sessionState(nvda, et("2026-12-24T14:00"));
    expect(s.nextOpen).toBe(et("2026-12-28T09:30"));
  });

  it("handles the DST change (Nov 1 2026): Mon Nov 2 09:30 ET = 14:30 UTC", () => {
    const s = sessionState(nvda, et("2026-10-31T12:00"));
    expect(new Date(s.nextOpen!).toISOString()).toBe("2026-11-02T14:30:00.000Z");
    // Before DST ends, 09:30 ET = 13:30 UTC.
    expect(new Date(et("2026-10-30T09:30")).toISOString()).toBe("2026-10-30T13:30:00.000Z");
  });

  it("lists one interval per trading day", () => {
    const ivs = sessionIntervals(nvda, et("2026-10-19T00:00"), et("2026-10-25T23:59"));
    expect(ivs.length).toBe(5);
  });
});

describe("CME Globex (commodities, assumed)", () => {
  it("Saturday closed; reopens Sunday 18:00", () => {
    const s = sessionState(xau, et("2026-10-24T12:00"));
    expect(s.underlying).toBe("closed");
    expect(s.nextOpen).toBe(et("2026-10-25T18:00"));
    expect(s.nextClose).toBe(et("2026-10-26T17:00"));
  });

  it("daily 17:00–18:00 break", () => {
    expect(sessionState(xau, et("2026-10-21T17:30")).underlying).toBe("closed");
    expect(sessionState(xau, et("2026-10-21T17:30")).nextOpen).toBe(et("2026-10-21T18:00"));
    expect(sessionState(xau, et("2026-10-21T12:00")).underlying).toBe("open");
  });

  it("Friday 17:00 closes for the weekend", () => {
    expect(sessionState(xau, et("2026-10-23T16:59")).underlying).toBe("open");
    expect(sessionState(xau, et("2026-10-23T17:00")).underlying).toBe("closed");
  });
});

describe("unknown and crypto", () => {
  it("non-US listing without cited hours is unknown", () => {
    const s = sessionState(sessionFor("SKHYNIX-USD"), et("2026-10-22T12:00"));
    expect(s).toEqual({ underlying: "unknown", nextOpen: null, nextClose: null });
  });
  it("crypto (no entry) is always open", () => {
    expect(sessionState(undefined, et("2026-10-24T12:00")).underlying).toBe("open");
  });
});
