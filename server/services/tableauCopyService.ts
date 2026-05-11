import { CustomerRuleModel } from '../models/CustomerRule';
import { TableauAPIClient } from './tableauAPI';
import { parseTableauViewUrl, appendTableauSheet } from '../rules/_base';

export interface TableauCopyResult {
  stepId: string;
  sheetName: string;
  status: 'copied' | 'skipped' | 'failed';
  rowsCopied?: number;
  error?: string;
}

/**
 * Runs all enabled tableau_table_copy steps from every active approved rule for the
 * given customer. Collects results for each step — never swallows failures silently.
 *
 * Called at workbook level after fillInvoice() completes. Safe to call when no
 * tableau-copy rules exist (returns empty array immediately).
 */
export async function applyTableauCopyRules(
  customerName: string,
  outputPath: string
): Promise<TableauCopyResult[]> {
  const activeRules = CustomerRuleModel.getAllActiveByCustomer(customerName);
  if (activeRules.length === 0) return [];

  // Collect all tableau_table_copy steps across all active rules
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

    const sheetName = step.config.targetSheet || parsed.view;

    try {
      const viewData = await client.findViewByName(parsed.workbook, parsed.view);
      if (!viewData) {
        const err = `View "${parsed.view}" not found in workbook "${parsed.workbook}"`;
        console.error(`[TableauCopy] step ${step.id}: ${err}`);
        results.push({ stepId: step.id, sheetName, status: 'failed', error: err });
        continue;
      }

      const rows = viewData.rows.map(row =>
        viewData.columns.map(c => row[c] ?? '')
      );
      await appendTableauSheet(
        outputPath,
        sheetName,
        viewData.columns,
        rows,
        step.config.includeHeaders !== false
      );
      console.log(`[TableauCopy] step ${step.id}: wrote ${rows.length} rows to sheet "${sheetName}"`);
      results.push({ stepId: step.id, sheetName, status: 'copied', rowsCopied: rows.length });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[TableauCopy] step ${step.id} FAILED:`, msg);
      results.push({ stepId: step.id, sheetName, status: 'failed', error: msg });
    }
  }

  return results;
}
