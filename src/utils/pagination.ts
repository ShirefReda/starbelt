/**
 * Pagination for the quotation sheet.
 *
 * The sheet is rendered as explicit A4 pages so that the header band, the table
 * header row and the footer band repeat deterministically on every page, and
 * the closing block (totals + notes + thank-you + approval) is never split
 * across pages or orphaned alone.
 *
 * All heights are in the same unit as the measurements (px at 96dpi); the
 * component measures real DOM heights and feeds them in. Pure and unit-tested.
 */

export interface PaginateInput {
  /** Measured height of each item row, in document order. */
  rowHeights: number[];
  /** Space for item rows on page 1 (page content minus title/client minus head). */
  firstPageRowCapacity: number;
  /** Space for item rows on pages 2+ (page content minus repeated head). */
  otherPageRowCapacity: number;
  /**
   * Height of the closing block measured *with* a table header present, i.e.
   * totals rows + notes + words + validity + thank-you + approval.
   */
  tailHeight: number;
  /** Height of the repeated table header row. */
  tableHeadHeight: number;
}

export interface PaginateResult {
  /** Row indices (into rowHeights) grouped per page. May be empty for the tail. */
  pages: number[][];
  /** True when the closing block sits on a page with no item rows. */
  tailAlone: boolean;
}

/**
 * Greedy first-fit packing of rows into pages, then placement of the
 * unsplittable closing block. If the block would be orphaned alone on the final
 * page, the last row of the previous page is pulled down with it.
 */
export function paginateRows(input: PaginateInput): PaginateResult {
  const { rowHeights, firstPageRowCapacity, otherPageRowCapacity, tailHeight, tableHeadHeight } =
    input;

  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  let capacity = Math.max(0, firstPageRowCapacity);

  const flush = () => {
    pages.push(current);
    current = [];
    used = 0;
    capacity = Math.max(0, otherPageRowCapacity);
  };

  for (let i = 0; i < rowHeights.length; i++) {
    const h = rowHeights[i] ?? 0;
    if (current.length > 0 && used + h > capacity) flush();
    current.push(i);
    used += h;
  }

  // Place the closing block.
  const remaining = capacity - used;
  if (tailHeight <= remaining) {
    pages.push(current);
  } else {
    // The block needs its own page. A page carrying the block must also carry a
    // table header, so compare against otherPageRowCapacity - tableHeadHeight.
    const usableForTailAndRow = otherPageRowCapacity - tableHeadHeight;
    if (current.length > 0) {
      const lastRow = current[current.length - 1]!;
      const lastRowHeight = rowHeights[lastRow] ?? 0;
      if (lastRowHeight + tailHeight <= usableForTailAndRow) {
        current.pop();
        pages.push(current);
        pages.push([lastRow]);
      } else {
        pages.push(current);
        pages.push([]);
      }
    } else {
      pages.push([]);
    }
  }

  if (pages.length === 0) pages.push([]);
  const tailAlone = pages[pages.length - 1]!.length === 0;
  return { pages, tailAlone };
}

/** Total page count, guaranteed to be at least 1. */
export function pageCount(result: PaginateResult): number {
  return Math.max(1, result.pages.length);
}
