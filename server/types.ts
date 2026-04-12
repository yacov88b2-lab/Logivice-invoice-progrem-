export interface Pricelist {
  id: number;
  name: string;
  customer_name: string;
  warehouse_code: string;
  file_path: string;
  template_structure: TemplateStructure;
  created_at: string;
  updated_at: string;
}

export interface TemplateStructure {
  sheets: SheetStructure[];
  headerRow: number;
  columns: {
    segment: number;
    clause: number;
    category: number;
    unitOfMeasure: number;
    remark: number;
    rate: number;
    qty: number;
    total: number;
  };
}

export interface SheetStructure {
  name: string;
  type: 'invoice' | 'other';
  rowCount: number;
  lineItems: LineItem[];
}

export interface LineItem {
  row: number;
  segment: string;
  clause: string;
  category: string;
  unitOfMeasure: string;
  remark: string;
  rate: number;
  qty: number | null;
  total: number;
}

export interface Transaction {
  id: string;
  date: string;
  orderNumber: string;
  customer: string;
  warehouse: string;
  segment: string;
  movementType: string;
  category: string;
  unitOfMeasure: string;
  description: string;
  quantity: number;
}

export interface MatchResult {
  lineItem: LineItem;
  transaction: Transaction;
  sheetName: string;
  confidence: number;
  matchReason: string;
}

export interface UnmatchedItem {
  transaction: Transaction;
  reason: string;
  possibleMatches?: LineItem[];
}

export interface AuditEntry {
  id?: number;
  pricelist_id: number;
  user_id: number;
  date_range_start: string;
  date_range_end: string;
  api_data_summary: string;
  filled_rows: string;
  unmatched_rows?: string;
  output_file_path?: string;
  created_at?: string;
}
