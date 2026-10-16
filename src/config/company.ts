/**
 * COMPANY CONFIGURATION — single source of truth.
 *
 * This is the file to edit when company details change. All defaults here are
 * the "factory" values shipped with the app; a user can override them in the
 * Settings screen, and overrides are stored in localStorage. "Reset to
 * defaults" restores exactly these values.
 */

export interface Phone {
  /** Raw digits without separators, e.g. "01011074556". */
  value: string;
  /** Optional label shown in the sheet footer. */
  label?: string;
}

export interface CompanyConfig {
  name: string;
  taxCard: string;
  taxCardLabel: string;
  commercialRegister: string;
  commercialRegisterLabel: string;
  address: string;
  email: string;
  phones: Phone[];
  /** Default notes added to a brand new quotation. */
  defaultNotes: string[];
  defaultApprover: string;
  thankYou: string;
  logo: string;
}

export const companyDefaults: CompanyConfig = {
  name: "شركة ستار بيلت لتصنيع السيور",
  taxCard: "003-811-581",
  taxCardLabel: "بطاقة ضريبية رقم",
  commercialRegister: "16389",
  commercialRegisterLabel: "سجل تجارى",
  address: "العاشر من رمضان قطعة A6 بجوار الصوامع",
  email: "starbelt86@gmail.com",
  phones: [{ value: "01011074556" }, { value: "01227156258" }],
  defaultNotes: ["السعر: غيرشامل الضريبة."],
  defaultApprover: "تسنيم",
  thankYou: "ولكم جزيل الشكر",
  logo: "assets/logo.svg",
};

export function defaultPhones(): Phone[] {
  return companyDefaults.phones.map((p) => ({ ...p }));
}
