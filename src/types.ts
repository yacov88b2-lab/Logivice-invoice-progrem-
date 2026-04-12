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
  transaction: Transaction;
  lineItem: LineItem;
  sheetName: string;
  confidence: number;
  matchReason: string;
}

export interface UnmatchedItem {
  transaction: Transaction;
  reason: string;
  possibleMatches?: LineItem[];
}

export interface PreviewResponse {
  pricelist: {
    id: number;
    name: string;
    sheets: Array<{
      name: string;
      type: string;
      rowCount: number;
    }>;
  };
  summary: {
    totalTransactions: number;
    matched: number;
    unmatched: number;
  };
  transactions: Transaction[];
  matches: Array<{
    transaction: Transaction;
    lineItem: LineItem & { sheet: string };
    confidence: number;
    reason: string;
  }>;
  unmatched: UnmatchedItem[];
}

export interface GenerateResponse {
  success: boolean;
  pricelist: {
    id: number;
    name: string;
    customer: string;
    warehouse: string;
  };
  summary: {
    totalTransactions: number;
    matched: number;
    unmatched: number;
    filledRows: number;
  };
  matches: Array<{
    sheet: string;
    row: number;
    segment: string;
    clause: string;
    qty: number;
    confidence: number;
    reason: string;
  }>;
  unmatched: Array<{
    transaction: Partial<Transaction>;
    reason: string;
  }>;
  filledRows: Array<{
    sheet: string;
    row: number;
    oldQty: number | null;
    newQty: number;
    oldTotal: number;
    newTotal: number;
  }>;
  errors: string[];
  auditLogId: number;
  downloadUrl: string;
}
