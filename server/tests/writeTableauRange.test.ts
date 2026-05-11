import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseStartCell, writeTableauRange } from '../rules/_base';

// ── parseStartCell ────────────────────────────────────────────────────────────

describe('parseStartCell', () => {
  it('parses A1', () => {
    expect(parseStartCell('A1')).toEqual({ col: 1, row: 1 });
  });

  it('parses A10', () => {
    expect(parseStartCell('A10')).toEqual({ col: 1, row: 10 });
  });

  it('parses BC5', () => {
    // B=2, C=3: col = 2*26 + 3 = 55
    expect(parseStartCell('BC5')).toEqual({ col: 55, row: 5 });
  });

  it('parses lowercase ref', () => {
    expect(parseStartCell('b3')).toEqual({ col: 2, row: 3 });
  });

  it('returns null for empty string', () => {
    expect(parseStartCell('')).toBeNull();
  });

  it('returns null for zero row', () => {
    expect(parseStartCell('A0')).toBeNull();
  });

  it('returns null for missing column letters', () => {
    expect(parseStartCell('5')).toBeNull();
  });

  it('returns null for missing row number', () => {
    expect(parseStartCell('A')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseStartCell('not-a-cell')).toBeNull();
  });
});

// ── writeTableauRange ─────────────────────────────────────────────────────────

let tmpDir: string;
let workbookPath: string;

async function createWorkbook(sheetName: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  // Add sentinel values in cells outside the target range to verify preservation
  ws.getCell('A1').value = 'SENTINEL_A1';
  ws.getCell('Z99').value = 'SENTINEL_Z99';
  const p = path.join(tmpDir, `test_${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(p);
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-tableau-range-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeTableauRange', () => {
  it('writes data at A10 with headers', async () => {
    workbookPath = await createWorkbook('Total');
    const cols = ['Name', 'Value'];
    const rows = [['Alice', 'Blue'], ['Bob', 'Red']];

    const result = await writeTableauRange(workbookPath, 'Total', 'A10', cols, rows, true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(workbookPath);
    const ws = wb.getWorksheet('Total')!;

    expect(ws.getCell('A10').value).toBe('Name');
    expect(ws.getCell('B10').value).toBe('Value');
    expect(ws.getCell('A11').value).toBe('Alice');
    expect(ws.getCell('B11').value).toBe('Blue');
    expect(ws.getCell('A12').value).toBe('Bob');
    expect(ws.getCell('B12').value).toBe('Red');

    expect(result.rowsWritten).toBe(3); // 2 data + 1 header
    expect(result.colsWritten).toBe(2);
  });

  it('writes data without headers when includeHeaders=false', async () => {
    workbookPath = await createWorkbook('Sheet1');
    const cols = ['Col1', 'Col2'];
    const rows = [['X', 'Y']];

    const result = await writeTableauRange(workbookPath, 'Sheet1', 'B5', cols, rows, false);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(workbookPath);
    const ws = wb.getWorksheet('Sheet1')!;

    expect(ws.getCell('B5').value).toBe('X');
    expect(ws.getCell('C5').value).toBe('Y');

    expect(result.rowsWritten).toBe(1);
  });

  it('preserves unrelated cells outside the written range', async () => {
    workbookPath = await createWorkbook('Total');
    await writeTableauRange(workbookPath, 'Total', 'C3', ['H1'], [['val']], true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(workbookPath);
    const ws = wb.getWorksheet('Total')!;

    expect(ws.getCell('A1').value).toBe('SENTINEL_A1');
    expect(ws.getCell('Z99').value).toBe('SENTINEL_Z99');
  });

  it('throws for invalid startCell', async () => {
    workbookPath = await createWorkbook('Sheet1');
    await expect(
      writeTableauRange(workbookPath, 'Sheet1', 'A0', ['H'], [['v']], true)
    ).rejects.toThrow(/Invalid startCell/);
  });

  it('throws when target sheet does not exist', async () => {
    workbookPath = await createWorkbook('Sheet1');
    await expect(
      writeTableauRange(workbookPath, 'NonExistentSheet', 'A1', ['H'], [['v']], true)
    ).rejects.toThrow(/not found/);
  });

  it('handles empty rows array gracefully', async () => {
    workbookPath = await createWorkbook('Total');
    const result = await writeTableauRange(workbookPath, 'Total', 'A1', ['H1', 'H2'], [], true);
    expect(result.rowsWritten).toBe(1); // header only
    expect(result.colsWritten).toBe(2);
  });

  it('handles empty rows and no headers gracefully', async () => {
    workbookPath = await createWorkbook('Total');
    const result = await writeTableauRange(workbookPath, 'Total', 'A1', [], [], false);
    expect(result.rowsWritten).toBe(0);
    expect(result.colsWritten).toBe(0);
  });
});
