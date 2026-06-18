export interface RawLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface RawInvoice {
  invoice_number: string | null;
  vendor: string | null;
  issue_date: string | null;
  due_date: string | null;
  currency: string | null;
  line_items: RawLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}

export interface RawExtraction {
  confidence: number;
  multiple_invoices: boolean;
  invoice: RawInvoice;
}

export interface ClaudeExtractionResult extends RawExtraction {
  model_used: string;
}
