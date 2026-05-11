import { CustomerRuleModel } from '../models/CustomerRule';
import { TableauAPIClient } from './tableauAPI';
import { parseTableauViewUrl, appendTableauSheet, writeTableauRange } from '../rules/_base';

export interface TableauCopyResult {
  stepId: string;
  sheetName: string;
  status: 'copied' | 'skipped' | 'failed';
  mode?: 'raw_sheet' | 'target_range';
  startCell?: string;
  rowsCopied?: number;
  columnsCopied?: number;
  error?: string;
}

const START_CELL_RE = /^[A-Za-z]+[1-9][0-9]*$/;

/**
 * Runs all enabled tableau_table_copy steps from every active approved rule for the
 * given customer. Supports raw_sheet (new sheet) and target_range (write into an
 * existing sheet starting at a given cell). Never swallows failures silently.
 */
export async function applyTableauCopyRules(
  customerName: string,
  outputPath: string
): Promise<TableauCopyResult[]> {
  const activeRules = CustomerRuleModel.getAllActiveByCustomer(customerName);
  if (activeRules.length === 0) return [];

  const stepsToRun: Array<{ step: any }> = [];
  for (const rule of activeRules) {
    for (const step of rule.steps) {
      if (step.enabled !== false && step.type === 'tableau_table_copy') {
        stepsToRun.push({ step });
      }
    }
  }
  if (stepsToRun.length === 0) return [];

  const client = new TableauAPIClient();
  const results: TableauCopyResult[] = [];

  for (const { step } of stepsToRun) {
    // Validate URL first — cheap check before hitting Tableau API
    const parsed = parseTableauViewUrl(step.config?.url ?? '');
    if (!parsed) {
      const err = `Invalid Tableau URL: "${step.config?.url ?? ''}"`;
      console.error(`[TableauCopy] step ${step.id}: ${err}`);
      results.push({
        stepId: step.id,
        sheetName: step.config?.targetSheet ?? '(unknown)',
        status: 'skipped',
        error: err,
      });
      continue;
    }

    const mode: 'raw_sheet' | 'target_range' =
      step.config?.mode === 'target_range' ? 'target_range' : 'raw_sheet';
    const sheetName = step.config?.targetSheet || parsed.view;

    // For target_range: validate startCell before hitting Tableau API
    if (mode === 'target_range') {
      const startCell = String(step.config?.startCell ?? '').trim();
      if (!startCell || !START_CELL_RE.test(startCell)) {
        const err = `Invalid startCell: "${startCell}". Expected format like A10 or BC5.`;
        console.error(`[TableauCopy] step ${step.id}: ${err}`);
        results.push({ stepId: step.id, sheetName, status: 'skipped', mode, error: err });
        continue;
      }
    }

    try {
      const viewData = await client.findViewByName(parsed.workbook, parsed.view);
      if (!viewData) {
        const err = `View "${parsed.view}" not found in workbook "${parsed.workbook}"`;
        console.error(`[TableauCopy] step ${step.id}: ${err}`);
        results.push({ stepId: step.id, sheetName, status: 'failed', mode, error: err });
        continue;
      }

      const rows = viewData.rows.map(row =>
        viewData.columns.map(c => row[c] ?? '')
      );
      const includeHeaders = step.config?.includeHeaders !== false;

      if (mode === 'target_range') {
        const startCell = String(step.config.startCell).trim().toUpperCase();
        await writeTableauRange(outputPath, sheetName, startCell, viewData.columns, rows, includeHeaders);
        console.log(`[TableauCopy] step ${step.id}: wrote ${rows.length} rows to "${sheetName}"!${startCell}`);
        results.push({
          stepId: step.id,
          sheetName,
          status: 'copied',
          mode,
          startCell,
          rowsCopied: rows.length,
          columnsCopied: viewData.columns.length,
        });
      } else {
        await appendTableauSheet(outputPath, sheetName, viewData.columns, rows, includeHeaders);
        console.log(`[TableauCopy] step ${step.id}: wrote ${rows.length} rows to new sheet "${sheetName}"`);
        results.push({
          stepId: step.id,
          sheetName,
          status: 'copied',
          mode,
          rowsCopied: rows.length,
          columnsCopied: viewData.columns.length,
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[TableauCopy] step ${step.id} FAILED:`, msg);
      results.push({ stepId: step.id, sheetName, status: 'failed', mode, error: msg });
    }
  }

  return results;
}
