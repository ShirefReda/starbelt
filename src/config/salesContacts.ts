/** Sales WhatsApp contacts — shown in the "إرسال واتساب" picker. */
export interface SalesContact {
  name: string;
  phone: string; // Egyptian local form, e.g. 01011074556
}

export const salesContacts: SalesContact[] = [
  { name: "أحمد الصاوي", phone: "01011074556" },
  { name: "أحمد شبورة", phone: "01010738827" },
  { name: "تسنيم", phone: "01208841307" },
  { name: "شمس", phone: "01260094248" },
];
