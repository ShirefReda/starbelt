import { describe, it, expect } from "vitest";
import { paginateRows, pageCount } from "../src/utils/pagination";

describe("paginateRows", () => {
  it("keeps everything on one page when it fits", () => {
    const r = paginateRows({
      rowHeights: [80, 80, 80],
      firstPageRowCapacity: 500,
      otherPageRowCapacity: 500,
      tailHeight: 100,
      tableHeadHeight: 40,
    });
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toEqual([0, 1, 2]);
    expect(r.tailAlone).toBe(false);
  });

  it("splits rows into multiple pages", () => {
    const r = paginateRows({
      rowHeights: [80, 80, 80, 80, 80, 80],
      firstPageRowCapacity: 300,
      otherPageRowCapacity: 300,
      tailHeight: 100,
      tableHeadHeight: 40,
    });
    // Page 1: 3 rows (240). Remaining pages: 3 rows (240) + tail 100 = 340 > 300,
    // so the last row is pulled to accompany the tail.
    expect(r.pages).toHaveLength(3);
    expect(r.pages[0]).toEqual([0, 1, 2]);
    expect(r.pages[1]).toEqual([3, 4]);
    expect(r.pages[2]).toEqual([5]);
    expect(r.tailAlone).toBe(false);
  });

  it("never splits a single row", () => {
    const r = paginateRows({
      rowHeights: [300],
      firstPageRowCapacity: 250,
      otherPageRowCapacity: 250,
      tailHeight: 100,
      tableHeadHeight: 40,
    });
    expect(r.pages[0]).toEqual([0]);
  });

  it("keeps the tail with rows instead of orphaning it", () => {
    // tail (100) does not fit after 4 rows (4*200=800) in 700; last row pulled down.
    const r = paginateRows({
      rowHeights: [200, 200, 200, 200],
      firstPageRowCapacity: 700,
      otherPageRowCapacity: 700,
      tailHeight: 100,
      tableHeadHeight: 40,
    });
    // usable for tail+row = 700-40 = 660; last row 200 + tail 100 = 300 fits.
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toEqual([0, 1, 2]);
    expect(r.pages[1]).toEqual([3]);
    expect(r.tailAlone).toBe(false);
  });

  it("allows the tail to be alone only when even one row does not fit", () => {
    const r = paginateRows({
      rowHeights: [700],
      firstPageRowCapacity: 700,
      otherPageRowCapacity: 700,
      tailHeight: 100,
      tableHeadHeight: 40,
    });
    // Row 700 fills the page; tail 100 needs its own page.
    // Row 700 + tail 100 = 800 > 660 (otherPage - head), so row cannot accompany the tail.
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toEqual([0]);
    expect(r.pages[1]).toEqual([]);
    expect(r.tailAlone).toBe(true);
  });

  it("returns at least one page for no rows", () => {
    const r = paginateRows({
      rowHeights: [],
      firstPageRowCapacity: 500,
      otherPageRowCapacity: 500,
      tailHeight: 100,
      tableHeadHeight: 40,
    });
    expect(r.pages.length).toBeGreaterThan(0);
  });

  it("computes the page count", () => {
    const r = paginateRows({
      rowHeights: [80, 80, 80, 80, 80, 80, 80, 80],
      firstPageRowCapacity: 250,
      otherPageRowCapacity: 250,
      tailHeight: 80,
      tableHeadHeight: 40,
    });
    expect(pageCount(r)).toBe(r.pages.length);
  });
});
