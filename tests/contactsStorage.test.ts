// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import {
  loadContacts,
  saveContactsOrder,
  toggleContactStar,
  saveCustomContact,
  deleteCustomContact,
  resetContactsOrder,
  sortStarredFirst,
  readContactsStorage,
} from "../src/storage/contactsStorage";
import {
  normalizeContactNumber,
  formatPhoneForDisplay,
} from "../src/utils/whatsapp";
import { salesContacts } from "../src/config/salesContacts";

describe("WhatsApp Contacts & Local Storage Preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default sales contacts when localStorage is empty", () => {
    const list = loadContacts();
    expect(list.length).toBe(salesContacts.length);
    expect(list[0]?.name).toBe(salesContacts[0]?.name);
    expect(list[0]?.phone).toBe(salesContacts[0]?.phone);
    expect(list.every((c) => !c.starred)).toBe(true);
    expect(list.every((c) => !c.custom)).toBe(true);
  });

  it("toggles star status and persists locally", () => {
    const targetPhone = salesContacts[0]!.phone;
    const { isStarred } = toggleContactStar(targetPhone);
    expect(isStarred).toBe(true);

    const reloaded = loadContacts();
    const contact = reloaded.find((c) => c.phone === targetPhone);
    expect(contact?.starred).toBe(true);

    // Toggle off
    const { isStarred: unstarred } = toggleContactStar(targetPhone);
    expect(unstarred).toBe(false);
    expect(loadContacts().find((c) => c.phone === targetPhone)?.starred).toBe(false);
  });

  it("rearranges contacts via saveContactsOrder (drag-and-drop simulation) and persists order", () => {
    const list = loadContacts();
    const reversed = [...list].reverse();
    saveContactsOrder(reversed);

    const reloaded = loadContacts();
    expect(reloaded[0]?.phone).toBe(reversed[0]?.phone);
    expect(reloaded[reloaded.length - 1]?.phone).toBe(reversed[reversed.length - 1]?.phone);

    const stored = readContactsStorage();
    expect(stored.order[0]).toBe(reversed[0]?.phone);
  });

  it("adds a custom contact and prepends it to the list", () => {
    const customPhone = "01099887766";
    const customName = "عميل جديد";

    const updated = saveCustomContact(customName, customPhone);
    expect(updated[0]?.phone).toBe(customPhone);
    expect(updated[0]?.name).toBe(customName);
    expect(updated[0]?.custom).toBe(true);

    // Verify localStorage
    const stored = readContactsStorage();
    expect(stored.custom).toHaveLength(1);
    expect(stored.custom[0]?.phone).toBe(customPhone);
  });

  it("deletes a custom contact and removes it from storage", () => {
    const customPhone = "01099887766";
    saveCustomContact("عميل", customPhone);
    expect(loadContacts().some((c) => c.phone === customPhone)).toBe(true);

    const afterDelete = deleteCustomContact(customPhone);
    expect(afterDelete.some((c) => c.phone === customPhone)).toBe(false);

    const stored = readContactsStorage();
    expect(stored.custom.some((c) => c.phone === customPhone)).toBe(false);
    expect(stored.order.some((p) => p === customPhone)).toBe(false);
  });

  it("sorts starred contacts first when sortStarredFirst is called", () => {
    // Star the 3rd and 5th contacts
    const phone1 = salesContacts[2]!.phone;
    const phone2 = salesContacts[4]!.phone;
    toggleContactStar(phone1);
    toggleContactStar(phone2);

    const sorted = sortStarredFirst();
    expect(sorted[0]?.starred).toBe(true);
    expect(sorted[1]?.starred).toBe(true);
    expect(sorted[2]?.starred).toBe(false);
  });

  it("resets contact order back to default while keeping custom contacts", () => {
    // Reorder
    const list = loadContacts();
    saveContactsOrder([...list].reverse());
    expect(loadContacts()[0]?.phone).not.toBe(salesContacts[0]?.phone);

    // Reset
    const reset = resetContactsOrder();
    expect(reset[0]?.phone).toBe(salesContacts[0]?.phone);
  });

  it("normalizes Egyptian phone numbers in multiple formats", () => {
    expect(normalizeContactNumber("01011074556")).toBe("201011074556");
    expect(normalizeContactNumber("+201011074556")).toBe("201011074556");
    expect(normalizeContactNumber("00201011074556")).toBe("201011074556");
    expect(normalizeContactNumber("010-1107-4556")).toBe("201011074556");
    expect(normalizeContactNumber("٠١٠١١٠٧٤٥٥٦")).toBe("201011074556");
  });

  it("normalizes international numbers and formats for display", () => {
    expect(normalizeContactNumber("+966501234567")).toBe("966501234567");
    expect(formatPhoneForDisplay("+966501234567", "966501234567")).toBe("+966501234567");
    expect(formatPhoneForDisplay("01011074556", "201011074556")).toBe("01011074556");
  });

  it("rejects invalid phone numbers with clear error message", () => {
    expect(() => normalizeContactNumber("1234")).toThrow();
    expect(() => normalizeContactNumber("abcdefg")).toThrow();
  });
});
