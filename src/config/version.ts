/**
 * Star Belt Quotations — Versioning & Changelog System
 *
 * HOW TO ADD A NEW BUG FIX OR VERSION:
 * 1. Increment CURRENT_VERSION (e.g. from "1.1.0" to "1.1.1" or "1.2.0").
 * 2. Add a new release object at the beginning of APP_VERSIONS.
 * 3. In `changes`, specify category: "bug" | "feat" | "improvement" and the Arabic description.
 *
 * All users will automatically see the updates pop-up dialog on their next visit/refresh!
 */

export type ChangeCategory = "bug" | "feat" | "improvement";

export interface VersionChange {
  category: ChangeCategory;
  text: string;
  details?: string;
}

export interface AppVersion {
  version: string;
  date: string;
  title: string;
  summary?: string;
  changes: VersionChange[];
}

export const CURRENT_VERSION = "1.1.0";

export const APP_VERSIONS: [AppVersion, ...AppVersion[]] = [
  {
    version: "1.1.0",
    date: "18 أكتوبر 2026",
    title: "تحديث معالجة الأخطاء وميزات جديدة",
    summary:
      "تم تدقيق منظومة الحسابات والتسعير ومعالجة كتابة الأصناف مع إضافة خيارات الخصم المتطورة.",
    changes: [
      {
        category: "bug",
        text: "خطأ في التسعير (تم تصحيح وتدقيق معادلات الإجمالي والخصم والضرائب لمنع أي تفاوت حسابي)",
      },
      {
        category: "bug",
        text: "خطأ في كتابة الأصناف (تحسين إدخال أسماء الأصناف الطويلة وتفادي أي أخطاء في العرض أو الطباعة)",
      },
      {
        category: "feat",
        text: "إضافة زر وخيارات الخصم (يدعم تحديد الخصم كنسبة مئوية % أو كمبلغ نقدي ثابت)",
      },
      {
        category: "improvement",
        text: "تحسين تصدير PDF وثبات الطباعة على الهواتف والأجهزة اللوحية",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "15 أكتوبر 2026",
    title: "الإصدار الرسمي لمنظومة عروض أسعار ستار بيلت",
    summary: "إطلاق محرر عروض الأسعار التفاعلي لشركة ستار بيلت لتصنيع السيور الناقلة والعوازل.",
    changes: [
      {
        category: "feat",
        text: "محرر مباشر تفاعلي بنظام الصفحات والطباعة الفورية وتفقيط الأرقام باللغة العربية",
      },
      {
        category: "feat",
        text: "إرسال العروض مباشرة عبر واتساب لعملاء الشركة ومسؤولي المبيعات",
      },
      {
        category: "feat",
        text: "حفظ تلقائي للبيانات والمسودات مع دعم العمل الكامل بدون إنترنت (Offline PWA)",
      },
    ],
  },
];

export const VERSION_STORAGE_KEY = "sb.lastSeenVersion";

/**
 * Returns the latest version release information.
 */
export function getLatestVersion(): AppVersion {
  return APP_VERSIONS[0];
}

/**
 * Returns the version string stored in localStorage, or null if not yet recorded.
 */
export function getStoredVersion(): string | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    return localStorage.getItem(VERSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Checks whether the current user has already seen and acknowledged the current version.
 */
export function hasSeenLatestVersion(version: string = CURRENT_VERSION): boolean {
  return getStoredVersion() === version;
}

/**
 * Marks the specified version (defaults to CURRENT_VERSION) as seen in localStorage.
 */
export function markVersionAsSeen(version: string = CURRENT_VERSION): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(VERSION_STORAGE_KEY, version);
  } catch {
    // localStorage might be unavailable or disabled
  }
}

/**
 * Determines whether the update dialog should be popped up automatically.
 */
export function shouldShowUpdatesPrompt(): boolean {
  return !hasSeenLatestVersion(CURRENT_VERSION);
}
