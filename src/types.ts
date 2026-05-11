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
  needsReview?: boolean;
  reviewReason?: string;
  alternatives?: Array<{
    lineItem: LineItem;
    sheetName: string;
    score: number;
  }>;
}

export interface UnmatchedItem {
  transaction: Transaction;
  reason: string;
  possibleMatches?: LineItem[];
  needsReview?: boolean;
  reviewReason?: string;
}

export interface ActiveRuleSummary {
  id: string;
  name: string;
  version: number;
  ruleType: string;
  enabled: boolean;
  approval_status: 'draft' | 'tested' | 'approved';
  stepCount: number;
}

export interface MatchDiagnostic {
  normalizedTransactionKey: string;
  normalizedLineItemKeys: string[];
  candidatesConsidered: number;
  scoreBreakdown?: {
    segment?: number;
    clause?: number;
    category?: number;
    unitOfMeasure?: number;
    description?: number;
    total: number;
  };
  matchType: 'exact' | 'fuzzy' | 'ambiguous' | 'unmatched';
  matchReason: string;
  alternatives?: Array<{
    lineItem: Partial<LineItem> & { sheet?: string };
    score: number;
  }>;
}

export interface RuleDiagnostic {
  transactionId: string;
  success: boolean;
  executedSteps: string[];
  errors: string[];
  warnings: string[];
  matchedCount: number;
  unmatchedCount: number;
  matchedLineItem?: Partial<LineItem> & { sheet?: string } | null;
  matcherDiagnostic?: MatchDiagnostic;
  dataMapperMatch?: {
    confidence: number;
    matchReason: string;
  };
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
    reviewRequired?: number;
  };
  activeRule?: ActiveRuleSummary | null;
  ruleDiagnostics?: RuleDiagnostic[];
  transactions: Transaction[];
  matches: Array<{
    transaction: Transaction;
    lineItem: LineItem & { sheet: string };
    confidence: number;
    reason: string;
    needsReview?: boolean;
    reviewReason?: string;
    alternatives?: Array<{
      lineItem: Partial<LineItem>;
      score: number;
    }>;
  }>;
  unmatched: Array<{
    transaction: Transaction;
    reason: string;
    needsReview?: boolean;
    alternatives?: Array<{
      lineItem: Partial<LineItem>;
      score: number;
    }>;
  }>;
  reviewQueue?: Array<{
    transaction: Transaction;
    alternatives: Array<{
      lineItem: LineItem & { sheet: string };
      score: number;
    }>;
    reason: string;
  }>;
}

export interface TableauCopyResult {
  stepId: string;
  sheetName: string;
  status: 'copied' | 'skipped' | 'failed';
  rowsCopied?: number;
  error?: string;
}

export interface GenerateResponse {
  success: boolean;
  pricelist: {
    id: number;
    name: string;
    customer: string;
    warehouse: string;
  };
  suggestedFilename?: string;
  activeRule?: ActiveRuleSummary | null;
  ruleDiagnostics?: RuleDiagnostic[];
  summary: {
    totalTransactions: number;
    matched: number;
    unmatched: number;
    reviewRequired?: number;
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
    needsReview?: boolean;
    reviewReason?: string;
    alternatives?: Array<{
      lineItem: Partial<LineItem>;
      score: number;
    }>;
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
  billingPeriod?: {
    mm: string;
    yyyy: string;
  } | null;
  tableauCopyResults?: TableauCopyResult[];
  auditLogId: number;
  downloadUrl: string;
}
