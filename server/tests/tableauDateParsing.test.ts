import { describe, it, expect } from 'vitest';
import { TableauAPIClient } from '../services/tableauAPI';

const client = new TableauAPIClient() as any;

describe('TableauAPIClient date parsing', () => {
  it('parses ISO date YYYY-MM-DD', () => {
    const d = client.parseDateValue('2026-03-15');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // 0-indexed March
    expect(d.getDate()).toBe(15);
  });

  it('parses dotted date DD.MM.YYYY', () => {
    const d = client.parseDateValue('15.03.2026');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  it('parses slash date MM/DD/YYYY', () => {
    const d = client.parseDateValue('03/15/2026');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2); // March = 2
    expect(d.getDate()).toBe(15);
  });

  it('returns null for empty string', () => {
    const d = client.parseDateValue('');
    expect(d).toBeNull();
  });

  it('returns null for clearly invalid date', () => {
    const d = client.parseDateValue('not-a-date');
    expect(d).toBeNull();
  });

  it('parseLocalDate parses YYYY-MM-DD without timezone shift', () => {
    const d = client.parseLocalDate('2026-04-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April
    expect(d.getDate()).toBe(1);
  });
});
