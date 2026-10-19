import { salesContacts, type SalesContact } from "../config/salesContacts";

export interface ContactItem extends SalesContact {
  id: string;
  custom?: boolean;
  starred?: boolean;
}

export interface ContactsStoredData {
  order: string[]; // List of phone numbers in custom order
  starred: string[]; // List of starred phone numbers
  custom: Array<{ phone: string; name: string }>; // Custom contacts added by user
}

export const CONTACTS_STORAGE_KEY = "sb.whatsappContacts.v1";

export function readContactsStorage(): ContactsStoredData {
  if (typeof window === "undefined" || !window.localStorage) {
    return { order: [], starred: [], custom: [] };
  }
  try {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return { order: [], starred: [], custom: [] };
    const parsed = JSON.parse(raw);
    return {
      order: Array.isArray(parsed?.order) ? parsed.order : [],
      starred: Array.isArray(parsed?.starred) ? parsed.starred : [],
      custom: Array.isArray(parsed?.custom) ? parsed.custom : [],
    };
  } catch {
    return { order: [], starred: [], custom: [] };
  }
}

export function writeContactsStorage(data: ContactsStoredData): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage quota exceeded or disabled
  }
}

/**
 * Loads contacts merging default sales contacts and user-added custom contacts,
 * applying the user's custom drag-and-drop order and starred preferences.
 */
export function loadContacts(): ContactItem[] {
  const data = readContactsStorage();
  const starredSet = new Set(data.starred);

  // Default sales contacts from config
  const defaultItems: ContactItem[] = salesContacts.map((c) => ({
    id: c.phone,
    name: c.name,
    phone: c.phone,
    admin: c.admin,
    custom: false,
    starred: starredSet.has(c.phone),
  }));

  // Custom user contacts from localStorage
  const customItems: ContactItem[] = data.custom.map((c) => ({
    id: c.phone,
    name: c.name,
    phone: c.phone,
    custom: true,
    starred: starredSet.has(c.phone),
  }));

  const allMap = new Map<string, ContactItem>();
  for (const item of [...defaultItems, ...customItems]) {
    allMap.set(item.phone, item);
  }

  // If a custom ordering was saved, sort accordingly
  if (data.order.length > 0) {
    const ordered: ContactItem[] = [];
    const seen = new Set<string>();

    for (const phone of data.order) {
      const item = allMap.get(phone);
      if (item && !seen.has(phone)) {
        ordered.push(item);
        seen.add(phone);
      }
    }

    // Append any contacts that aren't yet in the saved order (e.g. newly added defaults)
    for (const item of allMap.values()) {
      if (!seen.has(item.phone)) {
        ordered.push(item);
        seen.add(item.phone);
      }
    }

    return ordered;
  }

  return [...defaultItems, ...customItems];
}

/**
 * Saves the current list order into localStorage.
 */
export function saveContactsOrder(contacts: ContactItem[]): void {
  const data = readContactsStorage();
  data.order = contacts.map((c) => c.phone);
  writeContactsStorage(data);
}

/**
 * Toggles the starred status of a contact by phone number.
 */
export function toggleContactStar(phone: string): { contacts: ContactItem[]; isStarred: boolean } {
  const data = readContactsStorage();
  const set = new Set(data.starred);
  let isStarred = false;

  if (set.has(phone)) {
    set.delete(phone);
    isStarred = false;
  } else {
    set.add(phone);
    isStarred = true;
  }

  data.starred = Array.from(set);
  writeContactsStorage(data);

  return { contacts: loadContacts(), isStarred };
}

/**
 * Adds or updates a custom contact, placing it at the top of the order list.
 */
export function saveCustomContact(name: string, phone: string): ContactItem[] {
  const data = readContactsStorage();
  const trimmedPhone = phone.trim();
  const trimmedName = name.trim() || trimmedPhone;

  // Filter out any existing custom contact with this phone
  data.custom = data.custom.filter((c) => c.phone !== trimmedPhone);
  data.custom.unshift({ name: trimmedName, phone: trimmedPhone });

  // Place at the top of the ordering list so it's immediately prominent
  data.order = [trimmedPhone, ...data.order.filter((p) => p !== trimmedPhone)];

  writeContactsStorage(data);
  return loadContacts();
}

/**
 * Removes a custom contact by phone number.
 */
export function deleteCustomContact(phone: string): ContactItem[] {
  const data = readContactsStorage();
  data.custom = data.custom.filter((c) => c.phone !== phone);
  data.order = data.order.filter((p) => p !== phone);
  data.starred = data.starred.filter((p) => p !== phone);
  writeContactsStorage(data);
  return loadContacts();
}

/**
 * Resets the order back to default order while preserving custom contacts.
 */
export function resetContactsOrder(): ContactItem[] {
  const data = readContactsStorage();
  data.order = [];
  writeContactsStorage(data);
  return loadContacts();
}

/**
 * Reorders contacts so that all starred contacts appear first at the top,
 * and saves this new order into localStorage.
 */
export function sortStarredFirst(): ContactItem[] {
  const current = loadContacts();
  const sorted = [...current].sort((a, b) => {
    if (a.starred && !b.starred) return -1;
    if (!a.starred && b.starred) return 1;
    return 0;
  });
  saveContactsOrder(sorted);
  return sorted;
}
