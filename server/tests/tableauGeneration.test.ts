import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('../models/CustomerRule', () => ({
  CustomerRuleModel: {
    getAllActiveByCustomer: vi.fn(),
    getActiveByCustomer: vi.fn(),
    getActiveMatchingByCustomer: vi.fn(),
  },
}));

vi.mock('../services/tableauAPI', () => ({
  TableauAPIClient: vi.fn(),
}));

vi.mock('../rules/_base', async () => {
  const actual = await vi.importActual<typeof import('../rules/_base')>('../rules/_base');
  return {
    ...actual,
    appendTableauSheet: vi.fn().mockResolvedValue(undefined),
    writeTableauRange: vi.fn().mockResolvedValue({ rowsWritten: 3, colsWritten: 3 }),
  };
});

// ── Imports (after mocks are declared) ───────────────────────────────────────

import { applyTableauCopyRules } from '../services/tableauCopyService';
import { CustomerRuleModel } from '../models/CustomerRule';
import { TableauAPIClient } from '../services/tableauAPI';
import { appendTableauSheet, writeTableauRange } from '../rules/_base';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_URL = 'https://dub01.online.tableau.com/#/site/logivice/views/SalesWorkbook/InboundView';

function makeRule(overrides: Partial<{ id: string; steps: any[] }> = {}) {
  return {
    id: overrides.id ?? 'rule_test_1',
    customer_id: 'CUST_A',
    name: 'Test Tableau Rule',
    version: 1,
    enabled: true,
    approval_status: 'approved',
    ruleType: 'matching',
    steps: overrides.steps ?? [
      {
        id: 'step_tc_1',
        type: 'tableau_table_copy',
        enabled: true,
        config: {
          url: VALID_URL,
          viewName: 'InboundView',
          mode: 'raw_sheet',
          targetSheet: 'Inbound Data',
          includeHeaders: true,
        },
      },
    ],
    created_at: new Date().toISOString(),
    created_by: 'test',
    updated_at: new Date().toISOString(),
    updated_by: 'test',
  };
}

const SAMPLE_VIEW_DATA = {
  viewId: 'v1',
  workbookId: 'wb1',
  columns: ['Date', 'Qty', 'Item'],
  rows: [
    { Date: '2026-01-01', Qty: '10', Item: 'Widget A' },
    { Date: '2026-01-02', Qty: '5',  Item: 'Widget B' },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('applyTableauCopyRules', () => {
  let mockFindViewByName: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindViewByName = vi.fn();
    vi.mocked(TableauAPIClient).mockImplementation(
      function () { return { findViewByName: mockFindViewByName }; } as any
    );
  });

  // ── No rules ───────────────────────────────────────────────────────────────

  it('returns empty array when no active rules exist for customer', async () => {
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([]);
    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');
    expect(results).toHaveLength(0);
    expect(appendTableauSheet).not.toHaveBeenCalled();
  });

  it('returns empty array when active rules have no tableau_table_copy steps', async () => {
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([
      makeRule({
        steps: [{ id: 'step_1', type: 'match_transaction', enabled: true, config: { matchFields: ['segment'] } }],
      }),
    ] as any);
    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');
    expect(results).toHaveLength(0);
    expect(appendTableauSheet).not.toHaveBeenCalled();
  });

  // ── Successful copy ────────────────────────────────────────────────────────

  it('copies Tableau data to workbook and reports copied status', async () => {
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([makeRule()] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      stepId: 'step_tc_1',
      sheetName: 'Inbound Data',
      status: 'copied',
      rowsCopied: 2,
    });
  });

  it('calls appendTableauSheet with correct workbook path, sheet name, and data', async () => {
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([makeRule()] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    await applyTableauCopyRules('CUST_A', '/tmp/workbook.xlsx');

    expect(appendTableauSheet).toHaveBeenCalledWith(
      '/tmp/workbook.xlsx',
      'Inbound Data',
      ['Date', 'Qty', 'Item'],
      [
        ['2026-01-01', '10', 'Widget A'],
        ['2026-01-02', '5',  'Widget B'],
      ],
      true
    );
  });

  it('uses view name as sheet name when targetSheet is not configured', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_tc_2',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: VALID_URL, mode: 'raw_sheet' },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    const call = vi.mocked(appendTableauSheet).mock.calls[0];
    expect(call[1]).toBe('InboundView'); // view name from URL, no targetSheet
  });

  it('passes includeHeaders=false when config sets it to false', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_tc_3',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: VALID_URL, mode: 'raw_sheet', includeHeaders: false },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    const call = vi.mocked(appendTableauSheet).mock.calls[0];
    expect(call[4]).toBe(false);
  });

  // ── Failure cases (must NOT be swallowed silently) ─────────────────────────

  it('reports failed status when view is not found in Tableau', async () => {
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([makeRule()] as any);
    mockFindViewByName.mockResolvedValueOnce(null);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      stepId: 'step_tc_1',
      sheetName: 'Inbound Data',
      status: 'failed',
    });
    expect(results[0].error).toContain('InboundView');
    expect(appendTableauSheet).not.toHaveBeenCalled();
  });

  it('reports failed status when findViewByName throws', async () => {
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([makeRule()] as any);
    mockFindViewByName.mockRejectedValueOnce(new Error('Network timeout'));

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results[0]).toMatchObject({ status: 'failed', error: 'Network timeout' });
    expect(appendTableauSheet).not.toHaveBeenCalled();
  });

  it('reports skipped status when URL is invalid', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_bad_url',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: 'https://notallowed.com/views/X/Y', targetSheet: 'Bad', mode: 'raw_sheet' },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results[0]).toMatchObject({ stepId: 'step_bad_url', status: 'skipped' });
    expect(results[0].error).toMatch(/invalid tableau url/i);
    expect(mockFindViewByName).not.toHaveBeenCalled();
    expect(appendTableauSheet).not.toHaveBeenCalled();
  });

  // ── Multi-rule coexistence ─────────────────────────────────────────────────

  it('collects steps from multiple active rules and runs them all', async () => {
    const rule1 = makeRule({
      id: 'rule_1',
      steps: [
        {
          id: 'step_r1',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: VALID_URL, targetSheet: 'Sheet A', mode: 'raw_sheet', includeHeaders: true },
        },
      ],
    });
    const rule2 = makeRule({
      id: 'rule_2',
      steps: [
        {
          id: 'step_r2',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: VALID_URL, targetSheet: 'Sheet B', mode: 'raw_sheet', includeHeaders: true },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule1, rule2] as any);
    mockFindViewByName
      .mockResolvedValueOnce(SAMPLE_VIEW_DATA)
      .mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ stepId: 'step_r1', status: 'copied' });
    expect(results[1]).toMatchObject({ stepId: 'step_r2', status: 'copied' });
    expect(appendTableauSheet).toHaveBeenCalledTimes(2);
  });

  it('continues processing remaining steps after one fails', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_fail',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: VALID_URL, targetSheet: 'Fail Sheet', mode: 'raw_sheet', includeHeaders: true },
        },
        {
          id: 'step_ok',
          type: 'tableau_table_copy',
          enabled: true,
          config: { url: VALID_URL, targetSheet: 'OK Sheet', mode: 'raw_sheet', includeHeaders: true },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName
      .mockResolvedValueOnce(null)           // first step: view not found
      .mockResolvedValueOnce(SAMPLE_VIEW_DATA); // second step: success

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ stepId: 'step_fail', status: 'failed' });
    expect(results[1]).toMatchObject({ stepId: 'step_ok',   status: 'copied', rowsCopied: 2 });
  });

  // ── target_range mode ─────────────────────────────────────────────────────

  it('calls writeTableauRange (not appendTableauSheet) for target_range mode', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_tr_1',
          type: 'tableau_table_copy',
          enabled: true,
          config: {
            url: VALID_URL,
            targetSheet: 'Total',
            mode: 'target_range',
            startCell: 'A10',
            includeHeaders: true,
          },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(writeTableauRange).toHaveBeenCalledOnce();
    expect(appendTableauSheet).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      stepId: 'step_tr_1',
      status: 'copied',
      mode: 'target_range',
      startCell: 'A10',
      rowsCopied: 2,
      columnsCopied: 3,
    });
  });

  it('calls writeTableauRange with correct args for target_range', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_tr_args',
          type: 'tableau_table_copy',
          enabled: true,
          config: {
            url: VALID_URL,
            targetSheet: 'Summary',
            mode: 'target_range',
            startCell: 'B5',
            includeHeaders: false,
          },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    await applyTableauCopyRules('CUST_A', '/tmp/workbook.xlsx');

    expect(writeTableauRange).toHaveBeenCalledWith(
      '/tmp/workbook.xlsx',
      'Summary',
      'B5',
      ['Date', 'Qty', 'Item'],
      [
        ['2026-01-01', '10', 'Widget A'],
        ['2026-01-02', '5',  'Widget B'],
      ],
      false
    );
  });

  it('skips target_range step when startCell is invalid (before hitting Tableau API)', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_bad_cell',
          type: 'tableau_table_copy',
          enabled: true,
          config: {
            url: VALID_URL,
            targetSheet: 'Total',
            mode: 'target_range',
            startCell: 'A0',
            includeHeaders: true,
          },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results[0]).toMatchObject({ stepId: 'step_bad_cell', status: 'skipped' });
    expect(results[0].error).toMatch(/startCell/i);
    expect(mockFindViewByName).not.toHaveBeenCalled();
    expect(writeTableauRange).not.toHaveBeenCalled();
  });

  it('reports failed status when writeTableauRange throws', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_tr_throw',
          type: 'tableau_table_copy',
          enabled: true,
          config: {
            url: VALID_URL,
            targetSheet: 'Total',
            mode: 'target_range',
            startCell: 'A10',
            includeHeaders: true,
          },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);
    vi.mocked(writeTableauRange).mockRejectedValueOnce(new Error('Sheet "Total" not found in workbook'));

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results[0]).toMatchObject({ stepId: 'step_tr_throw', status: 'failed' });
    expect(results[0].error).toContain('Total');
  });

  it('result includes mode and startCell in copied entry', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_tr_meta',
          type: 'tableau_table_copy',
          enabled: true,
          config: {
            url: VALID_URL,
            targetSheet: 'Total',
            mode: 'target_range',
            startCell: 'C3',
            includeHeaders: true,
          },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);
    mockFindViewByName.mockResolvedValueOnce(SAMPLE_VIEW_DATA);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results[0]).toMatchObject({
      mode: 'target_range',
      startCell: 'C3',
      columnsCopied: 3,
    });
  });

  it('skips disabled tableau_table_copy steps', async () => {
    const rule = makeRule({
      steps: [
        {
          id: 'step_disabled',
          type: 'tableau_table_copy',
          enabled: false,
          config: { url: VALID_URL, targetSheet: 'Never', mode: 'raw_sheet', includeHeaders: true },
        },
      ],
    });
    vi.mocked(CustomerRuleModel.getAllActiveByCustomer).mockReturnValue([rule] as any);

    const results = await applyTableauCopyRules('CUST_A', '/tmp/out.xlsx');

    expect(results).toHaveLength(0);
    expect(mockFindViewByName).not.toHaveBeenCalled();
  });
});
