import { describe, it, expect } from 'vitest';
import { TemplateAnalyzer } from '../services/templateAnalyzer';
import type { LineItem } from '../types';

describe('TemplateAnalyzer.detectSheetType (via getLineItemKey)', () => {
  it('getLineItemKey produces pipe-delimited key', () => {
    const item: LineItem = {
      row: 1,
      segment: 'Inbound',
      clause: 'Per Order',
      category: 'General',
      unitOfMeasure: 'order',
      remark: '',
      rate: 14.7,
      qty: null,
      total: 0,
    };
    expect(TemplateAnalyzer.getLineItemKey(item)).toBe('Inbound|Per Order|General|order|');
  });
});

describe('TemplateAnalyzer sheet type detection', () => {
  const detectType = (name: string, hasRates = true): string => {
    const items: LineItem[] = hasRates ? [{
      row: 1, segment: 'Inbound', clause: 'Per Order', category: 'General',
      unitOfMeasure: 'order', remark: '', rate: 14.7, qty: null, total: 0,
    }] : [];
    return (TemplateAnalyzer as any).detectSheetType(name, items);
  };

  it('sheet named "warehouse" is invoice', () => {
    expect(detectType('WH Charges')).toBe('invoice');
  });

  it('sheet named "April 2026" is invoice', () => {
    expect(detectType('April 2026')).toBe('invoice');
  });

  it('sheet named "March 2026" is invoice', () => {
    expect(detectType('March 2026')).toBe('invoice');
  });

  it('sheet named "Summary" with no rates is other', () => {
    expect(detectType('Summary', false)).toBe('other');
  });

  it('sheet with rates but generic name is invoice', () => {
    expect(detectType('Sheet1', true)).toBe('invoice');
  });

  it('month names are case-insensitive', () => {
    expect(detectType('JANUARY 2026')).toBe('invoice');
    expect(detectType('january 2026')).toBe('invoice');
  });
});
