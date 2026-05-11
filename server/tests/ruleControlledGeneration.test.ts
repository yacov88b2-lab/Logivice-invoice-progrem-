import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module-level mocks (hoisted before imports) ───────────────────────────────

vi.mock('../models/CustomerRule');
vi.mock('../services/dataMapper');
vi.mock('../services/RuleEngine');
vi.mock('../models/AuditLog', () => ({
  AuditLogModel: {
    findByPeriod: vi.fn().mockReturnValue(null),
    create: vi.fn().mockReturnValue({ id: 99 }),
    createMatchAuditBatch: vi.fn(),
  },
}));
vi.mock('../models/Pricelist', () => ({
  PricelistModel: { getById: vi.fn() },
}));
vi.mock('../services/pricelistStorage', () => ({
  pricelistStorage: {
    fileExists: vi.fn().mockResolvedValue(true),
    retrieveFile: vi.fn().mockResolvedValue(Buffer.from('fake')),
  },
}));
vi.mock('../services/excelDataExtractor', () => ({
  ExcelDataExtractor: { extractFromAnalyzeSheet: vi.fn().mockReturnValue([]) },
}));
vi.mock('../services/tableauAPI', () => ({
  TableauAPIClient: vi.fn().mockImplementation(() => ({
    fetchTransactionsWithRawData: vi.fn().mockResolvedValue({
      transactions: [],
      rawViewData: new Map(),
      filteredViewData: new Map(),
    }),
    fetchTransactions: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../rules/index', () => ({
  fillInvoice: vi.fn().mockResolvedValue({ success: true, filledRows: [], errors: [], suggestedFilename: 'out.xlsx' }),
  extractAfimilkStoragePeriod: vi.fn().mockReturnValue(null),
}));
vi.mock('../services/tableauCopyService', () => ({
  applyTableauCopyRules: vi.fn().mockResolvedValue([]),
}));
vi.mock('fs', () => ({
  default: { existsSync: vi.fn().mockReturnValue(true), mkdirSync: vi.fn() },
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

// ── Imports after mock declarations ───────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { CustomerRuleModel } from '../models/CustomerRule';
import { DataMapper } from '../services/dataMapper';
import { RuleEngine } from '../services/RuleEngine';
import { PricelistModel } from '../models/Pricelist';
import { ExcelDataExtractor } from '../services/excelDataExtractor';
import generateRouter from '../routes/api/generate';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTx(id: string) {
  return { id, segment: 'SEG', movementType: 'IN', category: 'CAT', description: 'desc', quantity: 1, date: '2025-01-01', orderNumber: 'ORD1' };
}

function makeLineItem(sheet = 'Sheet1', row = 1) {
  return { sheetName: sheet, row, segment: 'SEG', clause: 'A', category: 'CAT', remark: '', rate: 10 };
}

const TEMPLATE = { sheets: [{ name: 'Sheet1', type: 'invoice', lineItems: [makeLineItem()], rowCount: 1 }] };

function makePricelist(customer = 'ACME') {
  return { id: 1, name: 'PL', customer_name: customer, warehouse_code: 'WH1', file_path: 'fake.xlsx', template_structure: TEMPLATE };
}

function makeActiveRule(name = 'My Rule') {
  return { id: 'r1', name, version: 1, enabled: true, approval_status: 'approved', ruleType: 'matching', steps: [] };
}

function makeRuleResult(matched: boolean, lineItem?: any) {
  return matched
    ? { success: true, errors: [], warnings: [], executedSteps: [], data: { matchedLineItem: lineItem ?? makeLineItem(), matches: [{ confidence: 0.95 }] } }
    : { success: false, errors: [], warnings: [], executedSteps: [], data: { matchedLineItem: null, matches: [] } };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/generate', generateRouter);
  return app;
}

const BASE = { pricelist_id: 1, start_date: '2025-01-01', end_date: '2025-01-31' };

// ── No active rule → DataMapper PRIMARY ──────────────────────────────────────

describe('No active rule — DataMapper PRIMARY path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CustomerRuleModel.getActiveMatchingByCustomer).mockReturnValue(null as any);
    vi.mocked(PricelistModel.getById).mockReturnValue(makePricelist() as any);
    vi.mocked(DataMapper.aggregateQuantities).mockReturnValue(new Map() as any);
  });

  it('preview: DataMapper results become the match set, rule engine not called', async () => {
    const tx = makeTx('tx1');
    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx] as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({
      matches: [{ lineItem: makeLineItem(), transaction: tx, sheetName: 'Sheet1', confidence: 0.8, matchReason: 'DM' }],
      unmatched: [],
    } as any);

    const res = await request(buildApp()).post('/api/generate/preview').send(BASE);

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(1);
    expect(res.body.summary.unmatched).toBe(0);
    expect(RuleEngine.evaluateRule).not.toHaveBeenCalled();
  });

  it('invoice: DataMapper results become the match set, rule engine not called', async () => {
    const tx = makeTx('tx1');
    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx] as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({
      matches: [{ lineItem: makeLineItem(), transaction: tx, sheetName: 'Sheet1', confidence: 0.8, matchReason: 'DM' }],
      unmatched: [],
    } as any);

    const res = await request(buildApp()).post('/api/generate/invoice').send({ ...BASE, user_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(1);
    expect(RuleEngine.evaluateRule).not.toHaveBeenCalled();
  });
});

// ── Active rule → Rule PRIMARY, DataMapper FALLBACK ──────────────────────────

describe('Active rule — Rule ENGINE PRIMARY path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CustomerRuleModel.getActiveMatchingByCustomer).mockReturnValue(makeActiveRule() as any);
    vi.mocked(PricelistModel.getById).mockReturnValue(makePricelist() as any);
    vi.mocked(DataMapper.aggregateQuantities).mockReturnValue(new Map() as any);
  });

  it('preview: rule-matched txs go to matches; rule-unmatched go to DataMapper as fallback', async () => {
    const tx1 = makeTx('tx1'); // rule matches
    const tx2 = makeTx('tx2'); // rule misses → DataMapper catches

    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx1, tx2] as any);
    // First 2 calls: primary matching (tx1=matched, tx2=miss); subsequent: buildRuleDiagnostics
    vi.mocked(RuleEngine.evaluateRule)
      .mockResolvedValueOnce(makeRuleResult(true) as any)
      .mockResolvedValue(makeRuleResult(false) as any);

    vi.mocked(DataMapper.mapTransactions).mockReturnValue({
      matches: [{ lineItem: makeLineItem('Sheet1', 2), transaction: tx2, sheetName: 'Sheet1', confidence: 0.7, matchReason: 'DM' }],
      unmatched: [],
    } as any);

    const res = await request(buildApp()).post('/api/generate/preview').send(BASE);

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(2);
    expect(res.body.summary.unmatched).toBe(0);

    // DataMapper must have been called with only the rule-unmatched transaction (tx2)
    const dmCalls = vi.mocked(DataMapper.mapTransactions).mock.calls;
    expect(dmCalls.length).toBeGreaterThanOrEqual(1);
    const primaryDmCall = dmCalls[0];
    expect(primaryDmCall[0]).toHaveLength(1);
    expect((primaryDmCall[0] as any[])[0]).toMatchObject({ id: 'tx2' });

    // The rule-matched tx1 should appear with a Rule match reason
    const ruleMatchedItems = res.body.matches.filter((m: any) => m.reason?.startsWith('Rule match'));
    expect(ruleMatchedItems).toHaveLength(1);
  });

  it('invoice: rule-matched items carry "Rule match" reason in response', async () => {
    const tx1 = makeTx('tx1');
    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx1] as any);
    vi.mocked(RuleEngine.evaluateRule).mockResolvedValue(makeRuleResult(true) as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({ matches: [], unmatched: [] } as any);

    const res = await request(buildApp()).post('/api/generate/invoice').send({ ...BASE, user_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(1);
    expect(res.body.matches[0].reason).toMatch(/^Rule match/);
  });

  it('invoice: rule evaluateRule throws → transaction falls back to DataMapper', async () => {
    const tx1 = makeTx('tx1'); // rule throws → DataMapper catches
    const tx2 = makeTx('tx2'); // rule misses → stays unmatched

    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx1, tx2] as any);
    vi.mocked(RuleEngine.evaluateRule)
      .mockRejectedValueOnce(new Error('rule boom'))
      .mockResolvedValue(makeRuleResult(false) as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({
      matches: [{ lineItem: makeLineItem(), transaction: tx1, sheetName: 'Sheet1', confidence: 0.6, matchReason: 'DM' }],
      unmatched: [{ transaction: tx2, reason: 'no match' }],
    } as any);

    const res = await request(buildApp())
      .post('/api/generate/invoice')
      .send({ ...BASE, user_id: 1, force_review: true });

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(1);
    expect(res.body.summary.unmatched).toBe(1);
  });

  it('preview: rule matches all → DataMapper receives empty array', async () => {
    const txs = [makeTx('a'), makeTx('b'), makeTx('c')];
    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue(txs as any);
    vi.mocked(RuleEngine.evaluateRule).mockResolvedValue(makeRuleResult(true) as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({ matches: [], unmatched: [] } as any);

    const res = await request(buildApp()).post('/api/generate/preview').send(BASE);

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(3);
    expect(res.body.summary.unmatched).toBe(0);

    // First DataMapper call (primary) must have received an empty array
    const firstCallArgs = vi.mocked(DataMapper.mapTransactions).mock.calls[0];
    expect(firstCallArgs[0]).toHaveLength(0);
  });
});

// ── Manual resolutions with active rule ──────────────────────────────────────

describe('Manual resolutions applied to DataMapper fallback unmatched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(CustomerRuleModel.getActiveMatchingByCustomer).mockReturnValue(makeActiveRule() as any);
    vi.mocked(PricelistModel.getById).mockReturnValue(makePricelist() as any);
    vi.mocked(DataMapper.aggregateQuantities).mockReturnValue(new Map() as any);
  });

  it('preview: resolvedItems selection is applied to DM-fallback needsReview items', async () => {
    const tx1 = makeTx('tx1');
    const li = makeLineItem();

    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx1] as any);
    vi.mocked(RuleEngine.evaluateRule).mockResolvedValue(makeRuleResult(false) as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({
      matches: [],
      unmatched: [{
        transaction: { ...tx1, customer: 'ACME', warehouse: 'WH1' },
        reason: 'low confidence',
        needsReview: true,
        reviewReason: 'ambiguous',
        alternatives: [{ lineItem: li, sheetName: 'Sheet1', score: 0.75 }],
      }],
    } as any);

    const res = await request(buildApp())
      .post('/api/generate/preview')
      .send({ ...BASE, resolvedItems: { tx1: 0 } });

    expect(res.status).toBe(200);
    expect(res.body.summary.matched).toBe(1);
    expect(res.body.summary.unmatched).toBe(0);
    expect(res.body.matches[0].reason).toMatch(/Manually resolved/);
  });

  it('invoice: unresolved needsReview items block generation without force_review', async () => {
    const tx1 = makeTx('tx1');

    vi.mocked(ExcelDataExtractor.extractFromAnalyzeSheet).mockReturnValue([tx1] as any);
    vi.mocked(RuleEngine.evaluateRule).mockResolvedValue(makeRuleResult(false) as any);
    vi.mocked(DataMapper.mapTransactions).mockReturnValue({
      matches: [],
      unmatched: [{
        transaction: { ...tx1, customer: 'ACME', warehouse: 'WH1' },
        reason: 'ambiguous',
        needsReview: true,
        alternatives: [{ lineItem: makeLineItem(), sheetName: 'Sheet1', score: 0.7 }],
      }],
    } as any);

    const res = await request(buildApp())
      .post('/api/generate/invoice')
      .send({ ...BASE, user_id: 1 }); // no force_review

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('unresolved_review_items');
    expect(res.body.count).toBe(1);
  });
});
