/**
 * Application store singleton + action layer.
 * All mutations flow through `store.commit` (undoable document edits) or
 * `store.patch` (settings / status). Components never mutate state directly.
 */

import { Store } from "./store";
import { SCHEMA_VERSION, emptyQuotation, type AppState, type Quotation } from "./quotation";
import { mergeCompany } from "../config/companyMerge";
import { LocalStorageQuotationRepository } from "../storage/localStorageRepository";
import { uid, localISODate } from "../utils/id";

export const repo = new LocalStorageQuotationRepository();

function cloneQuotation(q: Quotation): Quotation {
  return JSON.parse(JSON.stringify(q)) as Quotation;
}

function initialCompany() {
  return mergeCompany(repo.getCompanyOverrides());
}

function initialQuotation(): Quotation {
  const draft = repo.getDraft();
  if (draft) return draft;
  return makeFreshQuotation();
}

function makeFreshQuotation(): Quotation {
  const company = initialCompany();
  const now = new Date();
  const q: Quotation = {
    ...emptyQuotation(),
    id: uid("q"),
    number: repo.nextQuotationNumber(now.getFullYear()),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    items: [{ id: uid("it"), name: "", qty: 1, price: 0 }],
    notes: company.defaultNotes.map((text) => ({ id: uid("n"), text })),
    approver: company.defaultApprover,
    thankYou: company.thankYou,
  };
  return q;
}

const initialState: AppState = {
  quotation: initialQuotation(),
  company: initialCompany(),
  saveStatus: "idle",
};

export const store = new Store<AppState, Quotation>(initialState, "quotation", cloneQuotation);

/** Number for the current calendar year. */
export function currentYear(): number {
  return new Date().getFullYear();
}

/** File name for the exported PDF. */
export function quotationFileName(q: Quotation): string {
  const client = q.client.trim();
  const date = localISODate();
  return client ? `عرض سعر - ${client} - ${date}.pdf` : `عرض سعر - ${date}.pdf`;
}

export interface SheetActions {
  setClient(value: string): void;
  setAttention(value: string): void;
  addAttention(): void;
  removeAttention(): void;
  setApprover(value: string): void;
  setThankYou(value: string): void;
  setItemName(id: string, value: string): void;
  setItemQty(id: string, value: number): void;
  setItemPrice(id: string, value: number): void;
  addItem(): void;
  deleteItem(id: string): void;
  moveItem(fromIndex: number, toIndex: number): void;
  setNoteText(id: string, value: string): void;
  addNote(): void;
  deleteNote(id: string): void;
  setOption<K extends keyof Quotation["options"]>(key: K, value: Quotation["options"][K]): void;
  undo(): void;
  redo(): void;
  newQuotation(): void;
  duplicateQuotation(): void;
  clearQuotation(): void;
  loadQuotation(q: Quotation): void;
  rememberItemName(name: string): void;
}

export const actions: SheetActions = {
  setClient(value) {
    store.commit((d) => void (d.client = value), { field: "client" });
  },
  setAttention(value) {
    store.commit((d) => void (d.attention = value), { field: "attention" });
  },
  addAttention() {
    store.commit((d) => void (d.attention = ""), { clearsRedo: true });
  },
  removeAttention() {
    store.commit((d) => void (delete d.attention), { clearsRedo: true });
  },
  setApprover(value) {
    store.commit((d) => void (d.approver = value), { field: "approver" });
  },
  setThankYou(value) {
    store.commit((d) => void (d.thankYou = value), { field: "thankYou" });
  },
  setItemName(id, value) {
    store.commit(
      (d) => {
        const item = d.items.find((i) => i.id === id);
        if (item) item.name = value;
      },
      { field: `item-${id}-name` },
    );
  },
  setItemQty(id, value) {
    store.commit(
      (d) => {
        const item = d.items.find((i) => i.id === id);
        if (item) item.qty = value;
      },
      { field: `item-${id}-qty` },
    );
  },
  setItemPrice(id, value) {
    store.commit(
      (d) => {
        const item = d.items.find((i) => i.id === id);
        if (item) item.price = value;
      },
      { field: `item-${id}-price` },
    );
  },
  addItem() {
    store.commit(
      (d) => {
        d.items.push({ id: uid("it"), name: "", qty: 1, price: 0 });
      },
      { clearsRedo: true },
    );
  },
  deleteItem(id) {
    store.commit(
      (d) => {
        d.items = d.items.filter((i) => i.id !== id);
        // The sheet always keeps at least one editable row.
        if (d.items.length === 0) d.items.push({ id: uid("it"), name: "", qty: 1, price: 0 });
      },
      { clearsRedo: true },
    );
  },
  moveItem(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    store.commit(
      (d) => {
        const item = d.items[fromIndex];
        if (!item) return;
        d.items.splice(fromIndex, 1);
        d.items.splice(toIndex, 0, item);
      },
      { clearsRedo: true },
    );
  },
  setNoteText(id, value) {
    store.commit(
      (d) => {
        const note = d.notes.find((n) => n.id === id);
        if (note) note.text = value;
      },
      { field: `note-${id}` },
    );
  },
  addNote() {
    store.commit(
      (d) => {
        d.notes.push({ id: uid("no"), text: "" });
      },
      { clearsRedo: true },
    );
  },
  deleteNote(id) {
    store.commit(
      (d) => {
        d.notes = d.notes.filter((n) => n.id !== id);
      },
      { clearsRedo: true },
    );
  },
  setOption(key, value) {
    store.commit(
      (d) => {
        d.options[key] = value;
      },
      { field: `option-${key}` },
    );
  },
  undo() {
    store.undo();
  },
  redo() {
    store.redo();
  },
  newQuotation() {
    const q = makeFreshQuotation();
    store.replace({ ...store.get(), quotation: q });
  },
  duplicateQuotation() {
    const current = store.get().quotation;
    const now = new Date().toISOString();
    const copy: Quotation = {
      ...cloneQuotation(current),
      id: uid("q"),
      number: repo.nextQuotationNumber(new Date().getFullYear()),
      createdAt: now,
      updatedAt: now,
    };
    store.replace({ ...store.get(), quotation: copy });
  },
  clearQuotation() {
    const now = new Date().toISOString();
    store.replace({
      ...store.get(),
      quotation: {
        ...makeFreshQuotation(),
        id: uid("q"),
        number: repo.nextQuotationNumber(new Date().getFullYear()),
        createdAt: now,
        updatedAt: now,
        client: "",
      },
    });
  },
  loadQuotation(q) {
    const normalized = { ...q, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
    store.replace({ ...store.get(), quotation: normalized });
  },
  rememberItemName(name) {
    repo.rememberItemName(name);
  },
};

/** Accessors for tests / tools. */
export function getQuotation(): Quotation {
  return store.get().quotation;
}
export function setQuotation(q: Quotation): void {
  store.replace({ ...store.get(), quotation: q });
}
export function duplicateQuotation(): Quotation {
  actions.duplicateQuotation();
  return store.get().quotation;
}
export function newQuotation(): Quotation {
  actions.newQuotation();
  return store.get().quotation;
}
