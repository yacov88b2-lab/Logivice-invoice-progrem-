/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { DataMapper } from '../services/dataMapper';
import type { Transaction, TemplateStructure } from '../types';

const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'T1',
  date: '2026-01-01',
  orderNumber: 'ORD-001',
  customer: 'TestCo',
  warehouse: 'NL',
  segment: 'Inbound',
  movementType: 'Per Order',
  category: 'General',
  unitOfMeasure: 'order',
  description: '',
  quantity: 1,
  ...overrides,
});

const makeTemplate = (overrides: Partial<TemplateStructure['sheets'][0]['lineItems'][0]> = {}): TemplateStructure => ({
  sheets: [{
    name: 'Total',
    type: 'invoice',
    rowCount: 1,
    lineItems: [{
      row: 8,
      segment: 'Inbound',
      clause: 'Per Order',
      category: 'General',
      unitOfMeasure: 'order',
      remark: '',
      rate: 14.7,
      qty: null,
      total: 0,
      ...overrides,
    }],
  }],
  headerRow: 7,
  columns: { segment: 0, clause: 1, category: 2, unitOfMeasure: 3, remark: 4, rate: 5, qty: 6, total: 7 },
});

describe('DataMapper.mapTransactions', () => {
  it('exact match returns confidence 1.0', () => {
    const tx = makeTransaction();
    const template = makeTemplate();
    const { matches, unmatched } = DataMapper.mapTransactions([tx], template, Buffer.alloc(0));
    expect(matches).toHaveLength(1);
    expect(unmatched).toHaveLength(0);
    expect(matches[0].confidence).toBe(1.0);
    expect(matches[0].matchReason).toContain('Exact match');
  });

  it('unmatched transaction with no fuzzy candidate goes to unmatched', () => {
    const tx = makeTransaction({ segment: 'Customs', movementType: 'Clearance', category: 'ICL', unitOfMeasure: 'shipment' });
    const template = makeTemplate();
    const { matches, unmatched } = DataMapper.mapTransactions([tx], template, Buffer.alloc(0));
    expect(unmatched).toHaveLength(1);
    expect(matches).toHaveLength(0);
  });

  it('normalize treats "regular" and "general" as same', () => {
    const tx = makeTransaction({ category: 'Regular' });
    const template = makeTemplate({ category: 'General' });
    const { matches } = DataMapper.mapTransactions([tx], template, Buffer.alloc(0));
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe(1.0);
  });

  it('case-insensitive matching works', () => {
    const tx = makeTransaction({ segment: 'INBOUND', movementType: 'PER ORDER', category: 'GENERAL' });
    const template = makeTemplate();
    const { matches } = DataMapper.mapTransactions([tx], template, Buffer.alloc(0));
    expect(matches).toHaveLength(1);
  });

  it('aggregateQuantities sums quantities for same line item', () => {
    const tx1 = makeTransaction({ quantity: 3 });
    const tx2 = makeTransaction({ quantity: 7 });
    const template = makeTemplate();
    const { matches } = DataMapper.mapTransactions([tx1, tx2], template, Buffer.alloc(0));
    const aggregated = DataMapper.aggregateQuantities(matches);
    const values = Array.from(aggregated.values());
    expect(values[0].qty).toBe(10);
  });

  it('empty transactions returns empty results', () => {
    const { matches, unmatched } = DataMapper.mapTransactions([], makeTemplate(), Buffer.alloc(0));
    expect(matches).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });
});
