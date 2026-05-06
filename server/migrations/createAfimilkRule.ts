/**
 * Migration Script: Convert Afimilk Rules to JSON Format
 * 
 * This script converts the hardcoded Afimilk rule logic into a
 * CustomerRuleDefinition that can be stored and managed in the database.
 */

import type { CustomerRuleDefinition, RuleStep } from '../services/RuleEngine';

export function createAfimilkRuleDefinition(): CustomerRuleDefinition {
  const steps: RuleStep[] = [
    // Step 1: Extract inbound data from Tableau view
    {
      id: 'extract_inbound_view',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'inbound_view_data',
        outputKey: 'inboundData',
        transformType: 'none'
      },
      metadata: { description: 'Extract inbound scan data from Tableau' }
    },

    // Step 2: Extract storage data from Tableau view
    {
      id: 'extract_storage_view',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'storage_view_data',
        outputKey: 'storageData',
        transformType: 'none'
      },
      metadata: { description: 'Extract storage data from Tableau' }
    },

    // Step 3: Extract outbound data from Tableau view
    {
      id: 'extract_outbound_view',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'outbound_view_data',
        outputKey: 'outboundData',
        transformType: 'none'
      },
      metadata: { description: 'Extract outbound scan data from Tableau' }
    },

    // Step 4: Parse storage dates and group entries
    {
      id: 'parse_storage_entries',
      type: 'field_transform',
      enabled: true,
      config: {
        sourceKey: 'storageData',
        operation: 'storage_period_extraction',
        targetKey: 'storagePeriod',
        metadata: {
          description: 'Extract storage billing period from dates (MM, YYYY)',
          supportedDateFormats: [
            'Excel serial numbers (20000-80000)',
            'Unix timestamps (seconds/milliseconds)',
            'DD/MM/YYYY',
            'DD Month YYYY',
            'DD [ב]Month YYYY (Hebrew)'
          ]
        }
      },
      metadata: { description: 'Parse storage entry dates and extract billing period' }
    },

    // Step 5: Group storage data by (date, week, warehouse)
    {
      id: 'group_storage_entries',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'group_by_deduplicate',
        groupBy: ['date', 'week', 'warehouse'],
        sumFields: ['pallet', 'shelf'],
        outputKey: 'storageEntries'
      },
      metadata: { description: 'Deduplicate storage entries by date+week+warehouse' }
    },

    // Step 6: Build inbound sheet patch data
    {
      id: 'patch_inbound_sheet',
      type: 'field_transform',
      enabled: true,
      config: {
        sourceKey: 'inboundData',
        operation: 'excel_patch',
        targetKey: 'inboundPatch',
        excelConfig: {
          sheetName: 'Scans Inbound',
          columns: {
            B: 'Sub Inventory',
            C: 'Name (Service Levels)',
            D: 'Ref (Orders)',
            E: 'Inbound at',
            F: 'Item',
            G: 'box',
            H: 'item',
            I: 'pallet',
            J: 'serial'
          },
          dateFormat: 'DD/MM/YYYY',
          startRow: 2,
          maxRows: 5000
        }
      },
      metadata: { description: 'Create Excel patch for Inbound sheet' }
    },

    // Step 7: Build outbound sheet patch data
    {
      id: 'patch_outbound_sheet',
      type: 'field_transform',
      enabled: true,
      config: {
        sourceKey: 'outboundData',
        operation: 'excel_patch',
        targetKey: 'outboundPatch',
        excelConfig: {
          sheetName: 'Scans Outbound',
          columns: {
            B: 'Sub Inventory',
            C: 'Name (Service Levels)',
            E: 'Ref (Orders)',
            F: 'Shipped out',
            G: 'Repacking/Labeling'
          },
          dateFormat: 'DD/MM/YYYY',
          headerRowSearch: { columnB: 'sub inventory' }
        }
      },
      metadata: { description: 'Create Excel patch for Outbound sheet' }
    },

    // Step 8: Build storage sheet patch data
    {
      id: 'patch_storage_sheet',
      type: 'field_transform',
      enabled: true,
      config: {
        sourceKey: 'storageEntries',
        operation: 'excel_patch',
        targetKey: 'storagePatch',
        excelConfig: {
          sheetName: 'Storage',
          columns: {
            A: 'warehouse_name',
            B: 'week',
            C: 'date',
            D: 'pallet',
            E: 'shelf'
          },
          dateFormat: 'DD/MM/YYYY',
          headerRowSearch: { columnC: 'day of created at' }
        }
      },
      metadata: { description: 'Create Excel patch for Storage sheet with weekly totals' }
    },

    // Step 9: Rename inbound sheet if period matches
    {
      id: 'rename_inbound_sheet',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'storagePeriod_matches_expected',
        ifTrueKey: 'inboundSheetNewName',
        ifTrueValue: 'Scans Inbound {MM}-{YYYY}',
        ifFalseKey: 'inboundSheetNewName',
        ifFalseValue: 'Scans Inbound'
      },
      metadata: { description: 'Rename Inbound sheet to match billing period if dates align' }
    },

    // Step 10: Generate suggested filename
    {
      id: 'generate_filename',
      type: 'field_transform',
      enabled: true,
      config: {
        sourceKey: 'storagePeriod',
        operation: 'format_filename',
        targetKey: 'suggestedFilename',
        template: 'Afimilk New-Zealand -Test Invoice {MM}-{YYYY}.xlsx'
      },
      metadata: { description: 'Generate invoice filename from storage period' }
    }
  ];

  return {
    id: 'rule_afimilk_default',
    customer_id: 'Afimilk New Zealand',
    name: 'Afimilk Storage & Scan Processing',
    description: 'Default rule for Afimilk NZ: extracts storage billing period, patches inbound/outbound/storage sheets with Tableau data, renames sheets by period',
    version: 1,
    enabled: false,
    ruleType: 'transformation',
    steps,
    created_at: new Date().toISOString(),
    created_by: 'migration_script',
    updated_at: new Date().toISOString(),
    updated_by: 'migration_script'
  };
}

/**
 * Details for Afimilk Rule Implementation:
 * 
 * RULE TYPE: Transformation (not matching)
 * TRIGGERED BY: Customer name contains "afimilk"
 * 
 * LOGIC:
 * 1. Receives Tableau raw view data (Inbound, Outbound, Storage)
 * 2. Extracts storage billing period (MM-YYYY) from storage dates
 * 3. Deduplicates storage entries by (date, week, warehouse)
 * 4. Patches three Excel sheets:
 *    - Inbound: Sub Inventory, Service Level, Ref, Date, Item details, Pallet, Serial
 *    - Outbound: Sub Inventory, Service Level, Ref, Shipped Date, Repacking
 *    - Storage: Warehouse, Week, Date, Pallet count, Shelf count (with weekly totals)
 * 5. Renames "Scans Inbound" → "Scans Inbound MM-YYYY" if dates match
 * 6. Updates formulas to reference renamed sheet
 * 7. Returns suggested filename: "Afimilk New-Zealand -Test Invoice MM-YYYY.xlsx"
 * 
 * SPECIAL HANDLING:
 * - Date parsing: Supports Excel serial, Unix timestamps, DD/MM/YYYY, English/Hebrew month names
 * - XML manipulation: Patches OpenXML directly to preserve template formatting
 * - Field value extraction: Case-insensitive fallback for varying column names in Tableau views
 * - Period validation: Only renames sheet if inbound period matches expected billing period
 */
