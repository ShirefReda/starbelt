// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import {
  APP_VERSIONS,
  CURRENT_VERSION,
  getLatestVersion,
  hasSeenLatestVersion,
  markVersionAsSeen,
  shouldShowUpdatesPrompt,
  VERSION_STORAGE_KEY,
} from "../src/config/version";

describe("Versioning & Changelog System", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("CURRENT_VERSION matches the latest release version in APP_VERSIONS", () => {
    expect(CURRENT_VERSION).toBe("1.1.1");
    expect(APP_VERSIONS.length).toBeGreaterThan(0);
    expect(APP_VERSIONS[0]?.version).toBe(CURRENT_VERSION);
  });

  it("getLatestVersion returns the current release with title and changes", () => {
    const latest = getLatestVersion();
    expect(latest.version).toBe("1.1.1");
    expect(latest.title).toBeTruthy();
    expect(latest.changes.length).toBeGreaterThan(0);
  });

  it("includes required bug fixes (خطأ في التسعير and خطأ في كتابة الأصناف)", () => {
    const latest = getLatestVersion();
    const bugChanges = latest.changes.filter((c) => c.category === "bug");
    expect(bugChanges.length).toBeGreaterThanOrEqual(2);

    const hasPricingBug = bugChanges.some((c) => c.text.includes("خطأ في التسعير"));
    const hasItemsBug = bugChanges.some((c) => c.text.includes("خطأ في كتابة الأصناف"));

    expect(hasPricingBug).toBe(true);
    expect(hasItemsBug).toBe(true);
  });

  it("all changes have valid categories and non-empty text", () => {
    const validCategories = ["bug", "feat", "improvement"];
    for (const release of APP_VERSIONS) {
      expect(release.version).toBeTruthy();
      expect(release.date).toBeTruthy();
      for (const item of release.changes) {
        expect(validCategories).toContain(item.category);
        expect(item.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("correctly identifies when user has not yet seen the current version", () => {
    expect(hasSeenLatestVersion()).toBe(false);
    expect(shouldShowUpdatesPrompt()).toBe(true);
  });

  it("marks version as seen in localStorage and suppresses prompt", () => {
    markVersionAsSeen();
    expect(localStorage.getItem(VERSION_STORAGE_KEY)).toBe(CURRENT_VERSION);
    expect(hasSeenLatestVersion()).toBe(true);
    expect(shouldShowUpdatesPrompt()).toBe(false);
  });

  it("shows prompt again if a previous older version was stored", () => {
    localStorage.setItem(VERSION_STORAGE_KEY, "1.0.0");
    expect(hasSeenLatestVersion()).toBe(false);
    expect(shouldShowUpdatesPrompt()).toBe(true);
  });
});
