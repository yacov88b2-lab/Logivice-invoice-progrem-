import express from 'express';
import path from 'path';
import fs from 'fs';
import { PricelistModel } from '../../models/Pricelist';
import { AuditLogModel } from '../../models/AuditLog';
import { TableauAPIClient } from '../../services/tableauAPI';
import { ExcelDataExtractor } from '../../services/excelDataExtractor';
import { DataMapper } from '../../services/dataMapper';
import { QTYFiller } from '../../services/qtyFiller';

const router = express.Router();

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

    // Check if file exists
    if (!fs.existsSync(pricelist.file_path)) {
      return res.status(404).json({ error: 'Pricelist file not found' });
    }

    // Read pricelist file
    const pricelistBuffer = fs.readFileSync(pricelist.file_path);

    // Get transactions - either from Excel file or Tableau API
    let transactions;
    let rawViewData = new Map<string, any[]>();
    
    if (use_excel_data) {
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
    const outputDir = path.join(process.cwd(), 'uploads', 'generated');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      outputDir, 
      `${pricelist.customer_name}_${pricelist.warehouse_code}_${timestamp}.xlsx`
    );

    // Fill QTY and generate invoice (with raw Tableau data sheets)
    const fillResult = QTYFiller.fill(
      pricelistBuffer,
      pricelist.template_structure,
      quantityMap,
      outputPath,
      transactions,
      rawViewData // Pass raw Tableau view data for exact column matching
    );

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

    // Read pricelist file
    const pricelistBuffer = fs.readFileSync(pricelist.file_path);

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
