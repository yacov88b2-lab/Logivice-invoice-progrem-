import express from 'express';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { PricelistModel } from '../../models/Pricelist';
import { AuditLogModel, type MatchAuditRow } from '../../models/AuditLog';
import { TableauAPIClient } from '../../services/tableauAPI';
import { ExcelDataExtractor } from '../../services/excelDataExtractor';
import { DataMapper } from '../../services/dataMapper';
import { fillInvoice, extractAfimilkStoragePeriod } from '../../rules/index';
import { pricelistStorage } from '../../services/pricelistStorage';
import { applyTableauCopyRules } from '../../services/tableauCopyService';
import { CustomerRuleModel } from '../../models/CustomerRule';
import { RuleEngine } from '../../services/RuleEngine';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/auth';

const router = express.Router();
router.use(requireAuth);


function getInvoiceLineItems(templateStructure: any) {
  const lineItems: any[] = [];
  for (const sheet of templateStructure?.sheets || []) {
    if (sheet?.type !== 'invoice') continue;
    for (const item of sheet.lineItems || []) {
      lineItems.push({ ...item, sheetName: sheet.name });
    }
  }
  return lineItems;
}

async function buildRuleDiagnostics(
  customerName: string,
  transactions: any[],
  templateStructure: any,
  mapperMatches?: any[],
  mapperUnmatched?: any[]
) {
  const activeRule = CustomerRuleModel.getActiveMatchingByCustomer(customerName);
  if (!activeRule) {
    return {
      activeRule: null,
      diagnostics: []
    };
  }

  const lineItems = getInvoiceLineItems(templateStructure);
  const diagnostics = await Promise.all(transactions.map(async transaction => {
    const result = await RuleEngine.evaluateRule(activeRule, {
      transaction,
      lineItems,
      templateStructure,
      previousResults: {}
    });

    // Get DataMapper diagnostics
    const matcherDiag = DataMapper.getMatchDiagnostics(transaction, templateStructure);

    // Find corresponding mapper match result
    const mapperMatch = mapperMatches?.find(m => m.transaction?.id === transaction.id);

    return {
      transactionId: transaction.id,
      success: result.success,
      executedSteps: result.executedSteps,
      errors: result.errors,
      warnings: result.warnings,
      matchedCount: Array.isArray(result.data.matches) ? result.data.matches.length : 0,
      unmatchedCount: Array.isArray(result.data.unmatched) ? result.data.unmatched.length : 0,
      matchedLineItem: result.data.matchedLineItem
        ? {
            sheet: result.data.matchedLineItem.sheetName,
            row: result.data.matchedLineItem.row,
            segment: result.data.matchedLineItem.segment,
            clause: result.data.matchedLineItem.clause,
            category: result.data.matchedLineItem.category,
            remark: result.data.matchedLineItem.remark
          }
        : null,
      matcherDiagnostic: matcherDiag,
      dataMapperMatch: mapperMatch ? {
        confidence: mapperMatch.confidence,
        matchReason: mapperMatch.matchReason
      } : undefined
    };
  }));

  return {
    activeRule: {
      id: activeRule.id,
      name: activeRule.name,
      version: activeRule.version,
      ruleType: activeRule.ruleType,
      enabled: activeRule.enabled,
      approval_status: activeRule.approval_status,
      stepCount: activeRule.steps.length
    },
    diagnostics
  };
}

async function loadBillingTransactions(
  pricelist: any,
  pricelistBuffer: Buffer,
  startDate: string,
  endDate: string,
  useExcelData = true
): Promise<{ transactions: any[]; rawViewData: Map<string, any[]>; filteredViewData: Map<string, any[]> }> {
  const isAfimilkBilling = String(pricelist.customer_name || '').toLowerCase().includes('afimilk');
  let transactions: any[] = [];
  let rawViewData = new Map<string, any[]>();
  let filteredViewData = new Map<string, any[]>();

  if (useExcelData && !isAfimilkBilling) {
    transactions = ExcelDataExtractor.extractFromAnalyzeSheet(pricelistBuffer);

    if (transactions.length > 0) {
      return {
        transactions: transactions.map(t => ({
          ...t,
          customer: pricelist.customer_name,
          warehouse: pricelist.warehouse_code
        })),
        rawViewData,
        filteredViewData
      };
    }

    console.log('No data in Excel Analyze sheet, falling back to Tableau API');
  }

  const tableauClient = new TableauAPIClient();
  const result = await tableauClient.fetchTransactionsWithRawData(
    startDate,
    endDate,
    pricelist.customer_name,
    pricelist.warehouse_code
  );

  rawViewData = result.rawViewData;
  filteredViewData = result.filteredViewData;
  transactions = result.transactions;

  return { transactions, rawViewData, filteredViewData };
}

async function matchTransactionsForBilling(
  pricelist: any,
  pricelistBuffer: Buffer,
  transactions: any[],
  resolvedItems?: Record<string, number>
): Promise<{ matches: any[]; unmatched: any[]; activeRule: any | null }> {
  const primaryRule = CustomerRuleModel.getActiveMatchingByCustomer(pricelist.customer_name);
  const resolutionMap: Record<string, number> =
    resolvedItems && typeof resolvedItems === 'object' ? resolvedItems : {};

  const applyManualResolutions = (items: any[]) => {
    const resolvedMatches: any[] = [];
    const stillUnmatched: any[] = [];

    for (const u of items) {
      const selectedIdx = u?.transaction?.id ? resolutionMap[u.transaction.id] : undefined;
      if (u?.needsReview && u?.alternatives?.length && selectedIdx !== undefined) {
        const alt = u.alternatives[selectedIdx];
        if (alt) {
          resolvedMatches.push({
            lineItem: alt.lineItem,
            transaction: u.transaction,
            sheetName: alt.sheetName,
            confidence: alt.score,
            matchReason: `Manually resolved (score: ${(alt.score * 100).toFixed(0)}%)`
          });
          continue;
        }
      }
      stillUnmatched.push(u);
    }

    return { resolvedMatches, stillUnmatched };
  };

  if (primaryRule) {
    const lineItems = getInvoiceLineItems(pricelist.template_structure);
    const ruleMatches: any[] = [];
    const ruleUnmatched: any[] = [];

    for (const transaction of transactions) {
      try {
        const result = await RuleEngine.evaluateRule(primaryRule, {
          transaction,
          lineItems,
          templateStructure: pricelist.template_structure,
          previousResults: {}
        });

        if (result.success && result.data.matchedLineItem) {
          const matched = result.data.matchedLineItem;
          ruleMatches.push({
            lineItem: matched,
            transaction,
            sheetName: matched.sheetName || '',
            confidence: result.data.matches?.[0]?.confidence ?? 0.9,
            matchReason: `Rule match: ${primaryRule.name} v${primaryRule.version}`
          });
        } else {
          ruleUnmatched.push(transaction);
        }
      } catch {
        ruleUnmatched.push(transaction);
      }
    }

    const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(
      ruleUnmatched,
      pricelist.template_structure,
      pricelistBuffer
    );
    const { resolvedMatches, stillUnmatched } = applyManualResolutions(dmUnmatched);

    return {
      matches: [...ruleMatches, ...dmMatches, ...resolvedMatches],
      unmatched: stillUnmatched,
      activeRule: primaryRule
    };
  }

  const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(
    transactions,
    pricelist.template_structure,
    pricelistBuffer
  );
  const { resolvedMatches, stillUnmatched } = applyManualResolutions(dmUnmatched);

  return {
    matches: [...dmMatches, ...resolvedMatches],
    unmatched: stillUnmatched,
    activeRule: null
  };
}

// Export matched/unmatched + raw Tableau sheets using the same matching pipeline as preview/generate.
router.post('/export-total', async (req, res) => {
  try {
    const { pricelist_id, start_date, end_date, resolvedItems, use_excel_data = true } = req.body;

    if (!pricelist_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing required fields: pricelist_id, start_date, end_date'
      });
    }

    const pricelist = PricelistModel.getById(parseInt(pricelist_id));
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }

    // Check if file exists (SharePoint or local)
    const fileExists = await pricelistStorage.fileExists(pricelist.file_path);
    if (!fileExists) {
      return res.status(404).json({ error: 'Pricelist file not found' });
    }

    // Retrieve pricelist file from SharePoint or local storage
    const pricelistBuffer = await pricelistStorage.retrieveFile(pricelist.file_path);

    const { transactions, rawViewData } = await loadBillingTransactions(
      pricelist,
      pricelistBuffer,
      start_date,
      end_date,
      use_excel_data
    );

    if (transactions.length === 0) {
      return res.status(422).json({
        error: 'no_transaction_data',
        message: `No transactions found for ${pricelist.customer_name} / ${pricelist.warehouse_code} between ${start_date} and ${end_date}. Check the date range and confirm data is available in the pricelist file or Tableau.`
      });
    }

    const { matches, unmatched, activeRule } = await matchTransactionsForBilling(
      pricelist,
      pricelistBuffer,
      transactions,
      resolvedItems
    );

    const matchedRows = (matches || []).map((m: any) => ({
      status: 'Matched',
      matchedBy: m.matchReason?.startsWith('Rule match') ? 'rule_engine'
        : m.matchReason?.startsWith('Manually') ? 'manual_resolution'
        : 'data_mapper',
      activeRule: activeRule ? `${activeRule.name} v${activeRule.version}` : '',
      transactionId: m.transaction?.id ?? '',
      date: m.transaction?.date ?? '',
      orderNumber: m.transaction?.orderNumber ?? '',
      segment: m.transaction?.segment ?? '',
      movementType: m.transaction?.movementType ?? '',
      category: m.transaction?.category ?? '',
      unitOfMeasure: m.transaction?.unitOfMeasure ?? '',
      description: m.transaction?.description ?? '',
      quantity: m.transaction?.quantity ?? '',
      sheet: m.sheetName ?? '',
      row: m.lineItem?.row ?? '',
      clause: m.lineItem?.clause ?? '',
      remark: m.lineItem?.remark ?? '',
      rate: m.lineItem?.rate ?? '',
      confidence: m.confidence ?? '',
      reason: m.matchReason ?? ''
    }));

    const unmatchedRows = (unmatched || []).map((u: any) => ({
      status: u.needsReview ? 'Needs Review' : 'Unmatched',
      matchedBy: '',
      activeRule: activeRule ? `${activeRule.name} v${activeRule.version}` : '',
      transactionId: u.transaction?.id ?? '',
      date: u.transaction?.date ?? '',
      orderNumber: u.transaction?.orderNumber ?? '',
      segment: u.transaction?.segment ?? '',
      movementType: u.transaction?.movementType ?? '',
      category: u.transaction?.category ?? '',
      unitOfMeasure: u.transaction?.unitOfMeasure ?? '',
      description: u.transaction?.description ?? '',
      quantity: u.transaction?.quantity ?? '',
      sheet: '',
      row: '',
      clause: '',
      remark: '',
      rate: '',
      confidence: '',
      reason: u.reviewReason ?? u.reason ?? ''
    }));

    const allRows = [...matchedRows, ...unmatchedRows];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allRows), 'Transactions');

    // Add raw Tableau view sheets (each view name must be <= 31 chars in Excel)
    for (const [viewName, rows] of rawViewData.entries()) {
      const safeSheetName = String(viewName || 'Raw')
        .replace(/[\\/?*\[\]:]/g, '_')
        .slice(0, 31);

      const normalizedRows = Array.isArray(rows)
        ? rows.map((r: any) => (r && typeof r === 'object' ? r : { value: r }))
        : [];

      const ws = XLSX.utils.json_to_sheet(normalizedRows);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName || 'Raw');
    }

    const safeCustomer = String(pricelist.customer_name || 'Customer').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const filename = `${safeCustomer}_Total_Transactions.xlsx`;

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting total:', error);
    res.status(500).json({ error: 'Failed to export total', details: (error as Error).message });
  }
});

// Generate invoice from pricelist + API data or Excel file data
router.post('/invoice', async (req, res) => {
  try {
    const {
      pricelist_id,
      start_date,
      end_date,
      use_excel_data = true,
      resolvedItems,
      force = false,
      force_review = false
    } = req.body;
    const user_id = (req as AuthenticatedRequest).user.sub;

    if (!pricelist_id || !start_date || !end_date) {
      return res.status(400).json({ 
        error: 'Missing required fields: pricelist_id, start_date, end_date' 
      });
    }

    // Get pricelist
    const pricelist = PricelistModel.getById(parseInt(pricelist_id));
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }

    // Duplicate period check — block re-generation of the same period unless explicitly forced
    if (!force) {
      const existing = AuditLogModel.findByPeriod(parseInt(pricelist_id), start_date, end_date);
      if (existing) {
        return res.status(409).json({
          error: 'duplicate_period',
          message: `An invoice for this period was already generated on ${new Date(existing.created_at!).toLocaleString()}.`,
          existingAuditLogId: existing.id,
          generatedAt: existing.created_at
        });
      }
    }

    // Check if file exists (SharePoint or local)
    const fileExists = await pricelistStorage.fileExists(pricelist.file_path);
    if (!fileExists) {
      return res.status(404).json({ error: 'Pricelist file not found' });
    }

    // Retrieve pricelist file from SharePoint or local storage
    const pricelistBuffer = await pricelistStorage.retrieveFile(pricelist.file_path);

    const isAfimilkBilling = String(pricelist.customer_name || '').toLowerCase().includes('afimilk');

    // Get transactions - either from Excel file or Tableau API
    let transactions;
    let rawViewData = new Map<string, any[]>();
    let filteredViewData = new Map<string, any[]>();

    if (use_excel_data && !isAfimilkBilling) {
      // First try to extract from the uploaded Excel file itself (Analyze sheet)
      transactions = ExcelDataExtractor.extractFromAnalyzeSheet(pricelistBuffer);
      
      // If no data found in Excel, fallback to Tableau API
      if (transactions.length === 0) {
        console.log('No data in Excel Analyze sheet, falling back to Tableau API');
        const tableauClient = new TableauAPIClient();
        const result = await tableauClient.fetchTransactionsWithRawData(
          start_date,
          end_date,
          pricelist.customer_name,
          pricelist.warehouse_code
        );
        transactions = result.transactions;
        rawViewData = result.rawViewData;
        filteredViewData = result.filteredViewData;
      } else {
        console.log(`Using ${transactions.length} transactions from Excel file`);
        // Enrich with customer/warehouse info from pricelist
        transactions = transactions.map(t => ({
          ...t,
          customer: pricelist.customer_name,
          warehouse: pricelist.warehouse_code
        }));
      }
    } else {
      // Use Tableau API directly
      const tableauClient = new TableauAPIClient();
      const result = await tableauClient.fetchTransactionsWithRawData(
        start_date,
        end_date,
        pricelist.customer_name,
        pricelist.warehouse_code
      );
      transactions = result.transactions;
      rawViewData = result.rawViewData;
      filteredViewData = result.filteredViewData;
    }

    // Hard stop — never generate an invoice with zero transaction data
    if (transactions.length === 0) {
      return res.status(422).json({
        error: 'no_transaction_data',
        message: `No transactions found for ${pricelist.customer_name} / ${pricelist.warehouse_code} between ${start_date} and ${end_date}. Check the date range and confirm data is available in the pricelist file or Tableau.`
      });
    }

    // PRIMARY matching: rule engine if active approved rule exists, DataMapper otherwise
    const primaryRule = CustomerRuleModel.getActiveMatchingByCustomer(pricelist.customer_name);
    const resolutionMap: Record<string, number> =
      resolvedItems && typeof resolvedItems === 'object' ? resolvedItems : {};

    let matches: any[];
    let unmatched: any[];

    if (primaryRule) {
      // Rule engine PRIMARY — evaluate every transaction
      const lineItems = getInvoiceLineItems(pricelist.template_structure);
      const ruleMatches: any[] = [];
      const ruleUnmatched: any[] = [];
      for (const transaction of transactions) {
        try {
          const result = await RuleEngine.evaluateRule(primaryRule, {
            transaction, lineItems, templateStructure: pricelist.template_structure, previousResults: {}
          });
          if (result.success && result.data.matchedLineItem) {
            const matched = result.data.matchedLineItem;
            ruleMatches.push({
              lineItem: matched, transaction,
              sheetName: matched.sheetName || '',
              confidence: result.data.matches?.[0]?.confidence ?? 0.9,
              matchReason: `Rule match: ${primaryRule.name} v${primaryRule.version}`
            });
          } else {
            ruleUnmatched.push(transaction);
          }
        } catch {
          ruleUnmatched.push(transaction);
        }
      }

      // DataMapper FALLBACK on transactions the rule could not match
      const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(
        ruleUnmatched, pricelist.template_structure, pricelistBuffer
      );

      // Manual resolutions on DataMapper fallback unmatched
      const resolvedExtraMatches: any[] = [];
      const afterResolutionUnmatched: any[] = [];
      for (const u of dmUnmatched) {
        const selectedIdx = resolutionMap[(u as any).transaction?.id];
        if ((u as any).needsReview && (u as any).alternatives?.length && selectedIdx !== undefined) {
          const alt = (u as any).alternatives[selectedIdx];
          if (alt) {
            resolvedExtraMatches.push({
              lineItem: alt.lineItem,
              transaction: (u as any).transaction,
              sheetName: alt.sheetName,
              confidence: alt.score,
              matchReason: `Manually resolved (score: ${(alt.score * 100).toFixed(0)}%)`
            });
            continue;
          }
        }
        afterResolutionUnmatched.push(u);
      }

      const unresolvedReviewCount = afterResolutionUnmatched.filter((u: any) => u.needsReview).length;
      if (unresolvedReviewCount > 0 && !force_review) {
        return res.status(422).json({
          error: 'unresolved_review_items',
          count: unresolvedReviewCount,
          message: `${unresolvedReviewCount} transaction${unresolvedReviewCount !== 1 ? 's' : ''} in the review queue have not been resolved. Resolve them first, or pass force_review=true to skip and drop them from this invoice.`
        });
      }

      matches = [...ruleMatches, ...dmMatches, ...resolvedExtraMatches];
      unmatched = afterResolutionUnmatched;
    } else {
      // DataMapper PRIMARY — no active approved rule, legacy path
      const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(
        transactions, pricelist.template_structure, pricelistBuffer
      );

      const resolvedExtraMatches: any[] = [];
      const afterResolutionUnmatched: any[] = [];
      for (const u of dmUnmatched) {
        const selectedIdx = resolutionMap[(u as any).transaction?.id];
        if ((u as any).needsReview && (u as any).alternatives?.length && selectedIdx !== undefined) {
          const alt = (u as any).alternatives[selectedIdx];
          if (alt) {
            resolvedExtraMatches.push({
              lineItem: alt.lineItem,
              transaction: (u as any).transaction,
              sheetName: alt.sheetName,
              confidence: alt.score,
              matchReason: `Manually resolved (score: ${(alt.score * 100).toFixed(0)}%)`
            });
            continue;
          }
        }
        afterResolutionUnmatched.push(u);
      }

      const unresolvedReviewCount = afterResolutionUnmatched.filter((u: any) => u.needsReview).length;
      if (unresolvedReviewCount > 0 && !force_review) {
        return res.status(422).json({
          error: 'unresolved_review_items',
          count: unresolvedReviewCount,
          message: `${unresolvedReviewCount} transaction${unresolvedReviewCount !== 1 ? 's' : ''} in the review queue have not been resolved. Resolve them first, or pass force_review=true to skip and drop them from this invoice.`
        });
      }

      matches = [...dmMatches, ...resolvedExtraMatches];
      unmatched = afterResolutionUnmatched;
    }

    const reviewRequired = unmatched.filter((u: any) => u.needsReview).length;
    const ruleDiagnostics = await buildRuleDiagnostics(
      pricelist.customer_name,
      transactions,
      pricelist.template_structure,
      matches,
      unmatched
    );

    // Aggregate quantities
    const aggregated = DataMapper.aggregateQuantities(matches);
    
    // Convert aggregated data to Map<string, number> for QTYFiller
    const quantityMap = new Map<string, number>();
    aggregated.forEach((value, key) => {
      quantityMap.set(key, value.qty);
    });

    // Prepare output path
    const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
    const outputDir = path.join(dataDir, 'uploads', 'generated');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      outputDir, 
      `${pricelist.customer_name}_${pricelist.warehouse_code}_${timestamp}.xlsx`
    );

    // Compute expected billing period for Afimilk sheet rename
    const expectedInboundPeriod = (() => {
      const start = new Date(String(start_date));
      const end   = new Date(String(end_date));
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
      if (start.getFullYear() !== end.getFullYear()) return null;
      if (start.getMonth() !== end.getMonth()) return null;
      const mm   = String(start.getMonth() + 1).padStart(2, '0');
      const yyyy = String(start.getFullYear());
      return { mm, yyyy };
    })();

    // Fill QTY and generate invoice — dispatches to the correct customer rule
    const fillResult = await fillInvoice(
      pricelistBuffer,
      pricelist.template_structure,
      quantityMap,
      outputPath,
      pricelist.customer_name,
      transactions,
      rawViewData,
      filteredViewData,
      expectedInboundPeriod
    );

    // Apply tableau_table_copy rules (workbook-level, runs after the template is filled)
    const tableauCopyResults = await applyTableauCopyRules(pricelist.customer_name, outputPath);

    const billingPeriod = isAfimilkBilling
      ? extractAfimilkStoragePeriod(rawViewData?.get('Storage') ?? [])
      : null;

    // Log audit entry
    const auditEntry = AuditLogModel.create({
      pricelist_id: parseInt(pricelist_id),
      user_id,
      date_range_start: start_date,
      date_range_end: end_date,
      api_data_summary: JSON.stringify({
        totalTransactions: transactions.length,
        matchedTransactions: matches.length,
        unmatchedTransactions: unmatched.length,
        reviewRequired,
        activeRuleId: ruleDiagnostics.activeRule?.id ?? null,
        activeRuleVersion: ruleDiagnostics.activeRule?.version ?? null
      }),
      filled_rows: JSON.stringify(fillResult.filledRows),
      unmatched_rows: JSON.stringify(unmatched),
      output_file_path: outputPath
    });

    // Persist match-level audit — one row per matched transaction for dispute traceability
    const matchAuditRows: MatchAuditRow[] = matches.map((m: any) => ({
      audit_log_id: auditEntry.id!,
      transaction_id: m.transaction.id,
      transaction_segment: m.transaction.segment,
      transaction_movement_type: m.transaction.movementType,
      transaction_quantity: m.transaction.quantity,
      line_item_sheet: m.sheetName ?? m.lineItem?.sheetName,
      line_item_row: m.lineItem?.row,
      line_item_clause: m.lineItem?.clause,
      match_reason: m.matchReason,
      confidence: m.confidence,
      matched_by: m.matchReason?.startsWith('Rule match') ? 'rule_engine'
        : m.matchReason?.startsWith('Manually') ? 'manual_resolution'
        : 'data_mapper',
    }));
    AuditLogModel.createMatchAuditBatch(matchAuditRows);

    res.json({
      success: fillResult.success,
      pricelist: {
        id: pricelist.id,
        name: pricelist.name,
        customer: pricelist.customer_name,
        warehouse: pricelist.warehouse_code
      },
      suggestedFilename: fillResult.suggestedFilename,
      activeRule: ruleDiagnostics.activeRule,
      ruleDiagnostics: ruleDiagnostics.diagnostics,
      summary: {
        totalTransactions: transactions.length,
        matched: matches.length,
        unmatched: unmatched.length,
        reviewRequired,
        filledRows: fillResult.filledRows.length
      },
      matches: matches.map((m: any) => ({
        sheet: m.sheetName,
        row: m.lineItem.row,
        segment: m.lineItem.segment,
        clause: m.lineItem.clause,
        qty: m.transaction.quantity,
        confidence: m.confidence,
        reason: m.matchReason
      })),
      unmatched: unmatched.map((u: any) => ({
        transaction: {
          id: u.transaction.id,
          segment: u.transaction.segment,
          movementType: u.transaction.movementType,
          category: u.transaction.category,
          description: u.transaction.description
        },
        reason: u.reason,
        needsReview: u.needsReview,
        reviewReason: u.reviewReason,
        alternatives: u.alternatives
      })),
      filledRows: fillResult.filledRows,
      errors: fillResult.errors,
      billingPeriod,
      tableauCopyResults: tableauCopyResults.length > 0 ? tableauCopyResults : undefined,
      auditLogId: auditEntry.id,
      downloadUrl: `/api/generate/download/${auditEntry.id}`
    });

  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ error: 'Failed to generate invoice', details: (error as Error).message });
  }
});

// Preview mapping without generating (dry run)
router.post('/preview', async (req, res) => {
  try {
    const { pricelist_id, start_date, end_date, resolvedItems } = req.body;

    if (!pricelist_id || !start_date || !end_date) {
      return res.status(400).json({
        error: 'Missing required fields: pricelist_id, start_date, end_date'
      });
    }

    // Get pricelist
    const pricelist = PricelistModel.getById(parseInt(pricelist_id));
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }

    // Retrieve pricelist file from SharePoint or local storage
    const pricelistBuffer = await pricelistStorage.retrieveFile(pricelist.file_path);

    // Get transactions from Excel file (like generate endpoint)
    let transactions = ExcelDataExtractor.extractFromAnalyzeSheet(pricelistBuffer);

    // If no data in Excel, fallback to Tableau API
    if (transactions.length === 0) {
      console.log('No data in Excel Analyze sheet, falling back to Tableau API');
      const tableauClient = new TableauAPIClient();
      transactions = await tableauClient.fetchTransactions(
        start_date,
        end_date,
        pricelist.customer_name,
        pricelist.warehouse_code
      );
    } else {
      console.log(`Using ${transactions.length} transactions from Excel file for preview`);
      // Enrich with customer/warehouse info from pricelist
      transactions = transactions.map(t => ({
        ...t,
        customer: pricelist.customer_name,
        warehouse: pricelist.warehouse_code
      }));
    }

    // Hard stop — surface empty data early so users don't waste time reviewing a blank preview
    if (transactions.length === 0) {
      return res.status(422).json({
        error: 'no_transaction_data',
        message: `No transactions found for ${pricelist.customer_name} / ${pricelist.warehouse_code} between ${start_date} and ${end_date}. Check the date range and confirm data is available in the pricelist file or Tableau.`
      });
    }

    // PRIMARY matching: rule engine if active approved rule exists, DataMapper otherwise
    const primaryRule = CustomerRuleModel.getActiveMatchingByCustomer(pricelist.customer_name);
    const resolutionMap: Record<string, number> =
      resolvedItems && typeof resolvedItems === 'object' ? resolvedItems : {};

    let matches: any[];
    let unmatched: any[];

    if (primaryRule) {
      // Rule engine PRIMARY — evaluate every transaction
      const lineItems = getInvoiceLineItems(pricelist.template_structure);
      const ruleMatches: any[] = [];
      const ruleUnmatched: any[] = [];
      for (const transaction of transactions) {
        try {
          const result = await RuleEngine.evaluateRule(primaryRule, {
            transaction, lineItems, templateStructure: pricelist.template_structure, previousResults: {}
          });
          if (result.success && result.data.matchedLineItem) {
            const matched = result.data.matchedLineItem;
            ruleMatches.push({
              lineItem: matched, transaction,
              sheetName: matched.sheetName || '',
              confidence: result.data.matches?.[0]?.confidence ?? 0.9,
              matchReason: `Rule match: ${primaryRule.name} v${primaryRule.version}`
            });
          } else {
            ruleUnmatched.push(transaction);
          }
        } catch {
          ruleUnmatched.push(transaction);
        }
      }

      // DataMapper FALLBACK on transactions the rule could not match
      const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(
        ruleUnmatched, pricelist.template_structure, pricelistBuffer
      );

      // Manual resolutions on DataMapper fallback unmatched
      const resolvedMatches: any[] = [];
      const stillUnmatched: any[] = [];
      for (const u of dmUnmatched) {
        const selectedIdx = resolutionMap[(u as any).transaction?.id];
        if ((u as any).needsReview && (u as any).alternatives?.length && selectedIdx !== undefined) {
          const alt = (u as any).alternatives[selectedIdx];
          if (alt) {
            resolvedMatches.push({
              lineItem: alt.lineItem,
              transaction: (u as any).transaction,
              sheetName: alt.sheetName,
              confidence: alt.score,
              matchReason: `Manually resolved (score: ${(alt.score * 100).toFixed(0)}%)`
            });
            continue;
          }
        }
        stillUnmatched.push(u);
      }

      matches = [...ruleMatches, ...dmMatches, ...resolvedMatches];
      unmatched = stillUnmatched;
    } else {
      // DataMapper PRIMARY — no active approved rule, legacy path
      const { matches: rawMatches, unmatched: rawUnmatched } = DataMapper.mapTransactions(
        transactions, pricelist.template_structure, pricelistBuffer
      );

      const resolvedMatches: any[] = [];
      const stillUnmatched: any[] = [];
      for (const u of rawUnmatched) {
        const selectedIdx = resolutionMap[(u as any).transaction?.id];
        if ((u as any).needsReview && (u as any).alternatives?.length && selectedIdx !== undefined) {
          const alt = (u as any).alternatives[selectedIdx];
          if (alt) {
            resolvedMatches.push({
              lineItem: alt.lineItem,
              transaction: (u as any).transaction,
              sheetName: alt.sheetName,
              confidence: alt.score,
              matchReason: `Manually resolved (score: ${(alt.score * 100).toFixed(0)}%)`
            });
            continue;
          }
        }
        stillUnmatched.push(u);
      }

      matches = [...rawMatches, ...resolvedMatches];
      unmatched = stillUnmatched;
    }

    const ruleDiagnostics = await buildRuleDiagnostics(
      pricelist.customer_name,
      transactions,
      pricelist.template_structure,
      matches,
      unmatched
    );

    // Count review-required items. These are excluded from billable matches.
    const reviewRequired = unmatched.filter((u: any) => u.needsReview).length;
    const reviewQueue = unmatched
      .filter((u: any) => u.needsReview && u.alternatives)
      .map((u: any) => ({
        transaction: {
          id: u.transaction.id,
          date: u.transaction.date,
          orderNumber: u.transaction.orderNumber,
          segment: u.transaction.segment,
          movementType: u.transaction.movementType,
          category: u.transaction.category,
          unitOfMeasure: u.transaction.unitOfMeasure,
          description: u.transaction.description,
          quantity: u.transaction.quantity
        },
        alternatives: u.alternatives.map((alt: any) => ({
          lineItem: {
            sheet: alt.sheetName,
            row: alt.lineItem.row,
            segment: alt.lineItem.segment,
            clause: alt.lineItem.clause,
            category: alt.lineItem.category,
            remark: alt.lineItem.remark,
            rate: alt.lineItem.rate
          },
          score: alt.score
        })),
        reason: u.reviewReason || u.reason
      }));

    res.json({
      pricelist: {
        id: pricelist.id,
        name: pricelist.name,
        sheets: pricelist.template_structure.sheets.map((s: any) => ({
          name: s.name,
          type: s.type,
          rowCount: s.rowCount
        }))
      },
      summary: {
        totalTransactions: transactions.length,
        matched: matches.length,
        unmatched: unmatched.length,
        reviewRequired
      },
      activeRule: ruleDiagnostics.activeRule,
      ruleDiagnostics: ruleDiagnostics.diagnostics,
      transactions: transactions.map((t: any) => ({
        id: t.id,
        date: t.date,
        orderNumber: t.orderNumber,
        segment: t.segment,
        movementType: t.movementType,
        category: t.category,
        unitOfMeasure: t.unitOfMeasure,
        description: t.description,
        quantity: t.quantity
      })),
      matches: matches.map((m: any) => ({
        transaction: {
          id: m.transaction.id,
          date: m.transaction.date,
          segment: m.transaction.segment,
          movementType: m.transaction.movementType,
          category: m.transaction.category,
          description: m.transaction.description,
          quantity: m.transaction.quantity
        },
        lineItem: {
          sheet: m.sheetName,
          row: m.lineItem.row,
          segment: m.lineItem.segment,
          clause: m.lineItem.clause,
          category: m.lineItem.category,
          remark: m.lineItem.remark,
          rate: m.lineItem.rate
        },
        confidence: m.confidence,
        reason: m.matchReason,
        needsReview: m.needsReview,
        reviewReason: m.reviewReason,
        alternatives: m.alternatives
      })),
      unmatched: unmatched.map((u: any) => ({
        transaction: {
          id: u.transaction.id,
          date: u.transaction.date,
          segment: u.transaction.segment,
          movementType: u.transaction.movementType,
          category: u.transaction.category,
          description: u.transaction.description,
          quantity: u.transaction.quantity
        },
        reason: u.reason,
        needsReview: u.needsReview,
        reviewReason: u.reviewReason,
        alternatives: u.alternatives
      })),
      reviewQueue: reviewQueue.length > 0 ? reviewQueue : undefined
    });

  } catch (error) {
    console.error('Error previewing mapping:', error);
    res.status(500).json({ error: 'Failed to preview mapping', details: (error as Error).message });
  }
});

// ─── Region preview (dry run across all warehouses for a customer) ─────────────
router.post('/region-preview', async (req, res) => {
  try {
    const { customer_name: raw_customer_name, start_date, end_date } = req.body;
    const customer_name = typeof raw_customer_name === 'string' ? raw_customer_name.trim() : '';
    if (!customer_name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required fields: customer_name, start_date, end_date' });
    }

    const pricelists = PricelistModel.getByCustomerName(customer_name);
    if (pricelists.length === 0) {
      return res.status(404).json({ error: `No pricelists found for customer: ${customer_name}` });
    }

    let totalTransactions = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    const warehouseBreakdown: Array<{
      warehouse: string;
      pricelistName: string;
      matched: number;
      unmatched: number;
      total: number;
      error?: string;
    }> = [];

    for (const pricelist of pricelists) {
      try {
        const fileExists = await pricelistStorage.fileExists(pricelist.file_path);
        if (!fileExists) {
          warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: 0, unmatched: 0, total: 0, error: 'Pricelist file not found' });
          continue;
        }

        const pricelistBuffer = await pricelistStorage.retrieveFile(pricelist.file_path);
        let transactions = ExcelDataExtractor.extractFromAnalyzeSheet(pricelistBuffer);

        if (transactions.length === 0) {
          const tableauClient = new TableauAPIClient();
          transactions = await tableauClient.fetchTransactions(start_date, end_date, pricelist.customer_name, pricelist.warehouse_code);
        } else {
          transactions = transactions.map(t => ({ ...t, customer: pricelist.customer_name, warehouse: pricelist.warehouse_code }));
        }

        if (transactions.length === 0) {
          warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: 0, unmatched: 0, total: 0 });
          continue;
        }

        const primaryRule = CustomerRuleModel.getActiveMatchingByCustomer(pricelist.customer_name);
        let matched = 0;
        let unmatched = 0;

        if (primaryRule) {
          const lineItems = getInvoiceLineItems(pricelist.template_structure);
          const ruleUnmatched: any[] = [];
          for (const transaction of transactions) {
            try {
              const result = await RuleEngine.evaluateRule(primaryRule, { transaction, lineItems, templateStructure: pricelist.template_structure, previousResults: {} });
              if (result.success && result.data.matchedLineItem) matched++;
              else ruleUnmatched.push(transaction);
            } catch { ruleUnmatched.push(transaction); }
          }
          // DataMapper fallback for what the rule missed
          const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(ruleUnmatched, pricelist.template_structure, pricelistBuffer);
          matched += dmMatches.length;
          unmatched = dmUnmatched.length;
        } else {
          const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(transactions, pricelist.template_structure, pricelistBuffer);
          matched = dmMatches.length;
          unmatched = dmUnmatched.length;
        }

        warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched, unmatched, total: transactions.length });
        totalTransactions += transactions.length;
        totalMatched += matched;
        totalUnmatched += unmatched;
      } catch (err) {
        warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: 0, unmatched: 0, total: 0, error: (err as Error).message });
      }
    }

    res.json({
      customerName: customer_name,
      pricelistCount: pricelists.length,
      summary: { totalTransactions, matched: totalMatched, unmatched: totalUnmatched },
      warehouseBreakdown
    });
  } catch (error) {
    console.error('Error in region preview:', error);
    res.status(500).json({ error: 'Failed to preview region mapping', details: (error as Error).message });
  }
});

// ─── Region invoice (generate + merge all warehouses for a customer) ──────────
router.post('/region-invoice', async (req, res) => {
  try {
    const { customer_name: raw_customer_name, start_date, end_date, force = false } = req.body;
    const customer_name = typeof raw_customer_name === 'string' ? raw_customer_name.trim() : '';
    if (!customer_name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required fields: customer_name, start_date, end_date' });
    }

    const user_id = (req as AuthenticatedRequest).user.sub;
    const pricelists = PricelistModel.getByCustomerName(customer_name);
    if (pricelists.length === 0) {
      return res.status(404).json({ error: `No pricelists found for customer: ${customer_name}` });
    }

    const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), 'data');
    const outputDir = path.join(dataDir, 'uploads', 'generated');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const masterWb = XLSX.utils.book_new();
    const tempFiles: string[] = [];
    let totalTransactions = 0;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let totalFilledRows = 0;
    const allErrors: string[] = [];
    const warehouseBreakdown: Array<{ warehouse: string; pricelistName: string; matched: number; unmatched: number; total: number; filledRows: number; error?: string }> = [];

    for (const pricelist of pricelists) {
      try {
        const fileExists = await pricelistStorage.fileExists(pricelist.file_path);
        if (!fileExists) {
          warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: 0, unmatched: 0, total: 0, filledRows: 0, error: 'File not found' });
          continue;
        }

        const pricelistBuffer = await pricelistStorage.retrieveFile(pricelist.file_path);
        const { transactions, rawViewData, filteredViewData } = await loadBillingTransactions(pricelist, pricelistBuffer, start_date, end_date);

        if (transactions.length === 0) {
          warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: 0, unmatched: 0, total: 0, filledRows: 0 });
          continue;
        }

        const primaryRule = CustomerRuleModel.getActiveMatchingByCustomer(pricelist.customer_name);
        let matches: any[] = [];
        let unmatched: any[] = [];

        if (primaryRule) {
          const lineItems = getInvoiceLineItems(pricelist.template_structure);
          const ruleMatches: any[] = [];
          const ruleUnmatched: any[] = [];
          for (const transaction of transactions) {
            try {
              const result = await RuleEngine.evaluateRule(primaryRule, { transaction, lineItems, templateStructure: pricelist.template_structure, previousResults: {} });
              if (result.success && result.data.matchedLineItem) {
                ruleMatches.push({ lineItem: result.data.matchedLineItem, transaction, sheetName: result.data.matchedLineItem.sheetName || '', confidence: result.data.matches?.[0]?.confidence ?? 0.9, matchReason: `Rule match: ${primaryRule.name}` });
              } else { ruleUnmatched.push(transaction); }
            } catch { ruleUnmatched.push(transaction); }
          }
          const { matches: dmMatches, unmatched: dmUnmatched } = DataMapper.mapTransactions(ruleUnmatched, pricelist.template_structure, pricelistBuffer);
          matches = [...ruleMatches, ...dmMatches];
          unmatched = dmUnmatched;
        } else {
          const result = DataMapper.mapTransactions(transactions, pricelist.template_structure, pricelistBuffer);
          matches = result.matches;
          unmatched = result.unmatched;
        }

        const aggregated = DataMapper.aggregateQuantities(matches);
        const quantityMap = new Map<string, number>();
        aggregated.forEach((value, key) => quantityMap.set(key, value.qty));

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const tempPath = path.join(outputDir, `region_temp_${pricelist.warehouse_code}_${timestamp}.xlsx`);
        tempFiles.push(tempPath);

        const fillResult = await fillInvoice(pricelistBuffer, pricelist.template_structure, quantityMap, tempPath, pricelist.customer_name, transactions, rawViewData, filteredViewData, null);

        // Copy sheets into master workbook, prefixing with pricelist name to stay unique
        if (fs.existsSync(tempPath)) {
          const warehouseWb = XLSX.readFile(tempPath);
          const usedNames = new Set(masterWb.SheetNames);
          for (const sheetName of warehouseWb.SheetNames) {
            let newName = `${pricelist.warehouse_code} - ${sheetName}`.substring(0, 31);
            // Deduplicate if same warehouse_code appears multiple times
            let suffix = 2;
            while (usedNames.has(newName)) {
              newName = `${pricelist.warehouse_code}(${suffix}) - ${sheetName}`.substring(0, 31);
              suffix++;
            }
            usedNames.add(newName);
            XLSX.utils.book_append_sheet(masterWb, warehouseWb.Sheets[sheetName], newName);
          }
        }

        warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: matches.length, unmatched: unmatched.length, total: transactions.length, filledRows: fillResult.filledRows.length });
        totalTransactions += transactions.length;
        totalMatched += matches.length;
        totalUnmatched += unmatched.length;
        totalFilledRows += fillResult.filledRows.length;
        allErrors.push(...fillResult.errors);
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`[Region invoice] Error processing warehouse ${pricelist.warehouse_code} (${pricelist.name}):`, err);
        warehouseBreakdown.push({ warehouse: pricelist.warehouse_code, pricelistName: pricelist.name, matched: 0, unmatched: 0, total: 0, filledRows: 0, error: msg });
        allErrors.push(`${pricelist.warehouse_code}: ${msg}`);
      }
    }

    if (masterWb.SheetNames.length === 0) {
      const detail = allErrors.length > 0 ? allErrors.join('; ') : 'No data found for the given date range';
      return res.status(422).json({ error: `No output generated for any warehouse. ${detail}`, warehouseBreakdown });
    }

    // Save combined workbook
    const masterTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeCustomerName = customer_name.replace(/[^a-zA-Z0-9 _-]/g, '_');
    const masterPath = path.join(outputDir, `${safeCustomerName}_REGION_${masterTimestamp}.xlsx`);
    XLSX.writeFile(masterWb, masterPath);

    // Clean up temp files
    for (const t of tempFiles) { try { fs.unlinkSync(t); } catch {} }

    // Single audit log entry for the region invoice
    const auditEntry = AuditLogModel.create({
      pricelist_id: pricelists[0].id,
      user_id,
      date_range_start: start_date,
      date_range_end: end_date,
      api_data_summary: JSON.stringify({ region: customer_name, pricelistCount: pricelists.length, totalTransactions, totalMatched, totalUnmatched, warehouseBreakdown }),
      filled_rows: JSON.stringify({ totalFilledRows }),
      output_file_path: masterPath
    });

    res.json({
      success: true,
      customerName: customer_name,
      summary: { totalTransactions, matched: totalMatched, unmatched: totalUnmatched, filledRows: totalFilledRows },
      warehouseBreakdown,
      errors: allErrors,
      auditLogId: auditEntry.id,
      downloadUrl: `/api/generate/download/${auditEntry.id}`
    });
  } catch (error) {
    console.error('Error generating region invoice:', error);
    res.status(500).json({ error: 'Failed to generate region invoice', details: (error as Error).message });
  }
});

// Download generated file
router.get('/download/:auditId', (req, res) => {
  try {
    const auditId = parseInt(req.params.auditId);
    if (isNaN(auditId)) return res.status(400).json({ error: 'Invalid audit ID' });
    const auditEntry = AuditLogModel.getById(auditId);
    
    if (!auditEntry || !auditEntry.output_file_path) {
      return res.status(404).json({ error: 'Generated file not found' });
    }

    if (!fs.existsSync(auditEntry.output_file_path)) {
      return res.status(404).json({ error: 'File no longer exists' });
    }

    res.download(auditEntry.output_file_path);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: 'Failed to download file', details: (error as Error).message });
  }
});

export default router;
