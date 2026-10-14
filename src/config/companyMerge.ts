/** Merge persisted company overrides over the shipped defaults. */

import { companyDefaults, type CompanyConfig, type Phone } from "./company";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  return v.filter((x): x is string => typeof x === "string");
}

function asPhones(v: unknown, fallback: Phone[]): Phone[] {
  if (!Array.isArray(v)) return fallback;
  const out: Phone[] = [];
  for (const entry of v) {
    if (typeof entry === "string") out.push({ value: entry });
    else if (isRecord(entry) && typeof entry.value === "string") {
      out.push({
        value: entry.value,
        label: typeof entry.label === "string" ? entry.label : undefined,
      });
    }
  }
  return out.length > 0 ? out : fallback;
}

export function mergeCompany(overrides: Record<string, unknown>): CompanyConfig {
  return {
    name: asString(overrides.name, companyDefaults.name),
    taxCard: asString(overrides.taxCard, companyDefaults.taxCard),
    taxCardLabel: asString(overrides.taxCardLabel, companyDefaults.taxCardLabel),
    commercialRegister: asString(overrides.commercialRegister, companyDefaults.commercialRegister),
    commercialRegisterLabel: asString(
      overrides.commercialRegisterLabel,
      companyDefaults.commercialRegisterLabel,
    ),
    address: asString(overrides.address, companyDefaults.address),
    email: asString(overrides.email, companyDefaults.email),
    phones: asPhones(overrides.phones, companyDefaults.phones),
    defaultNotes: asStringArray(overrides.defaultNotes, companyDefaults.defaultNotes),
    defaultApprover: asString(overrides.defaultApprover, companyDefaults.defaultApprover),
    thankYou: asString(overrides.thankYou, companyDefaults.thankYou),
    logo: asString(overrides.logo, companyDefaults.logo),
  };
}

/** Only keep keys that actually differ from the defaults (keeps storage tidy). */
export function diffCompany(next: CompanyConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(companyDefaults) as (keyof CompanyConfig)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(companyDefaults[key])) {
      out[key] = next[key];
    }
  }
  return out;
}
