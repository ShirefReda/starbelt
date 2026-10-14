/** Sales WhatsApp contacts — shown in the "إرسال واتساب" picker. */
export interface SalesContact {
  name: string;
  phone: string; // Egyptian local form, e.g. 01011074556
  admin?: boolean;
}

export const salesContacts: SalesContact[] = [
  { name: "أحمد الصاوي", phone: "01011074556" },
  { name: "أحمد شبورة", phone: "01010738827" },
  { name: "تسنيم", phone: "01208841307" },
  { name: "شمس", phone: "01260094248" },
  { name: "هشام عبدالحي", phone: "01227156258" },
  { name: "بسملة", phone: "01208839485" },
  { name: "شريف رضا — ADMIN", phone: "01093525178", admin: true },
  { name: "شريف رضا — ADMIN", phone: "01208840531", admin: true },
];
