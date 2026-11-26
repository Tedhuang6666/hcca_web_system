export type AssistedItemDraft = {
  scope_key: string;
  id: string;
  product_id: string;
  product_name: string;
  category_id: string | null;
  quantity: number;
  option_ids: string[];
  option_label: string;
  unit_price: number;
};

export type AssistedOrderDraft = {
  id: string;
  student_id: string;
  student_name: string;
  items: AssistedItemDraft[];
  notes: string;
};

export type AssistedOrderDraftRow = AssistedOrderDraft & {
  subtotal: number;
  category_totals: { key: string; category_id: string | null; label: string; amount: number }[];
};
