import express from 'express';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { PricelistModel } from '../../models/Pricelist';
import { AuditLogModel } from '../../models/AuditLog';
import { TableauAPIClient } from '../../services/tableauAPI';
import { ExcelDataExtractor } from '../../services/excelDataExtractor';
import { DataMapper } from '../../services/dataMapper';
import { fillInvoice, extractAfimilkStoragePeriod } from '../../rules/index';
import { pricelistStorage } from '../../services/pricelistStorage';

const router = express.Router();

// Export matched/unmatched + raw Tableau sheets as a single Excel file
router.post('/export-total', async (req, res) => {
  try {
    const { pricelist_id, start_date, end_date } = req.body;

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

    const tableauClient = new TableauAPIClient();
    const { transactions, rawViewData } = await tableauClient.fetchTransactionsWithRawData(
      start_date,
      end_date,
      pricelist.customer_name,
      pricelist.warehouse_code
    );

    const { matches, unmatched } = DataMapper.mapTransactions(
      transactions,
      pricelist.template_structure,
      pricelistBuffer
    );

    const matchedRows = (matches || []).map((m: any) => ({
      status: 'Matched',
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
      status: 'Unmatched',
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
      reason: u.reason ?? ''
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
      use_excel_data = true,  // Default to using Excel data from uploaded file
      user_id = 1 
    } = req.body;

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

    // Map transactions to line items
    const { matches, unmatched } = DataMapper.mapTransactions(
      transactions,
      pricelist.template_structure,
      pricelistBuffer
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

    const billingPeriod = isAfimilkBilling
      ? extractAfimilkStoragePeriod(rawViewData?.get('Storage') ?? [])
      : null;

    // Log audit entry
    const auditEntry = AuditLogModel.create({
      pricelist_id: parseInt(pricelist_id),
      user_id: parseInt(user_id),
      date_range_start: start_date,
      date_range_end: end_date,
      api_data_summary: JSON.stringify({
        totalTransactions: transactions.length,
        matchedTransactions: matches.length,
        unmatchedTransactions: unmatched.length
      }),
      filled_rows: JSON.stringify(fillResult.filledRows),
      unmatched_rows: JSON.stringify(unmatched),
      output_file_path: outputPath
    });

    res.json({
      success: fillResult.success,
      pricelist: {
        id: pricelist.id,
        name: pricelist.name,
        customer: pricelist.customer_name,
        warehouse: pricelist.warehouse_code
      },
      suggestedFilename: fillResult.suggestedFilename,
      summary: {
        totalTransactions: transactions.length,
        matched: matches.length,
        unmatched: unmatched.length,
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
        reason: u.reason
      })),
      filledRows: fillResult.filledRows,
      errors: fillResult.errors,
      billingPeriod,
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
    const { pricelist_id, start_date, end_date } = req.body;

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

    // Map transactions (dry run)
    const { matches, unmatched } = DataMapper.mapTransactions(
      transactions,
      pricelist.template_structure,
      pricelistBuffer
    );

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
        unmatched: unmatched.length
      },
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
        reason: m.matchReason
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
        reason: u.reason
      }))
    });

  } catch (error) {
    console.error('Error previewing mapping:', error);
    res.status(500).json({ error: 'Failed to preview mapping', details: (error as Error).message });
  }
});

// Download generated file
router.get('/download/:auditId', (req, res) => {
  try {
    const auditId = parseInt(req.params.auditId);
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
