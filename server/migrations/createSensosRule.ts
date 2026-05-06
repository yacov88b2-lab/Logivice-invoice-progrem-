/**
 * Migration Script: Convert Sensos Rules to JSON Format
 * 
 * This script converts the hardcoded Sensos rule logic into a
 * CustomerRuleDefinition that can be stored and managed in the database.
 */

import type { CustomerRuleDefinition, RuleStep } from '../services/RuleEngine';

export function createSensosRuleDefinition(): CustomerRuleDefinition {
  const steps: RuleStep[] = [
    // Step 1: Extract Inbound view data
    {
      id: 'extract_inbound_data',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'inbound_view_data',
        outputKey: 'inboundData',
        transformType: 'none'
      },
      metadata: { description: 'Extract Inbound transaction data from Tableau' }
    },

    // Step 2: Extract Outbound view data
    {
      id: 'extract_outbound_data',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'outbound_view_data',
        outputKey: 'outboundData',
        transformType: 'none'
      },
      metadata: { description: 'Extract Outbound transaction data from Tableau' }
    },

    // Step 3: Extract Storage view data
    {
      id: 'extract_storage_data',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'storage_view_data',
        outputKey: 'storageData',
        transformType: 'none'
      },
      metadata: { description: 'Extract Storage metrics from Tableau' }
    },

    // Step 4: Extract VAS (Value Added Services) data
    {
      id: 'extract_vas_data',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'vas_view_data',
        outputKey: 'vasData',
        transformType: 'none'
      },
      metadata: { description: 'Extract VAS services data from Tableau' }
    },

    // Step 5: Extract Management data
    {
      id: 'extract_mgmt_data',
      type: 'field_extraction',
      enabled: true,
      config: {
        fieldName: 'management_view_data',
        outputKey: 'managementData',
        transformType: 'none'
      },
      metadata: { description: 'Extract management orders data from Tableau' }
    },

    // Step 6: Calculate inbound metrics
    {
      id: 'calc_inbound_orders',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'distinct_count',
        sourceKey: 'inboundData',
        field: 'Ref (Orders)',
        outputKey: '__sensos_inbound_orders'
      },
      metadata: { description: 'Count distinct inbound order references' }
    },

    {
      id: 'calc_inbound_boxes',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'sum',
        sourceKey: 'inboundData',
        field: 'Distinct count of Id (Billable Scan Logs)',
        outputKey: '__sensos_inbound_boxes'
      },
      metadata: { description: 'Sum inbound billable scan logs' }
    },

    // Step 7: Calculate outbound metrics (domestic vs international)
    {
      id: 'calc_outbound_dom_orders',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'distinct_count_filtered',
        sourceKey: 'outboundData',
        field: 'Ref (Orders)',
        filter: { field: 'Dom/Int', matches: ['local', 'domestic', 'dom'] },
        outputKey: '__sensos_outbound_dom_orders'
      },
      metadata: { description: 'Count distinct domestic outbound order references' }
    },

    {
      id: 'calc_outbound_int_orders',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'distinct_count_filtered',
        sourceKey: 'outboundData',
        field: 'Ref (Orders)',
        filter: { field: 'Dom/Int', matches: ["int'l", 'international', 'int'] },
        outputKey: '__sensos_outbound_int_orders'
      },
      metadata: { description: 'Count distinct international outbound order references' }
    },

    {
      id: 'calc_outbound_boxes',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'sum',
        sourceKey: 'outboundData',
        field: 'Distinct count of Id (Billable Scan Logs)',
        outputKey: '__sensos_outbound_boxes'
      },
      metadata: { description: 'Sum outbound billable scan logs' }
    },

    // Step 8: Calculate storage SqM (1.5 × max pallets)
    {
      id: 'calc_storage_sqm',
      type: 'field_transform',
      enabled: true,
      config: {
        sourceKey: 'storageData',
        operation: 'storage_sqm_calculation',
        targetKey: '__sensos_storage_total_sqm',
        formula: 'max_pallets * 1.5',
        metadata: {
          description: 'Storage area in square meters (pallet locations × 1.5)',
          pricing: {
            perAreaRate: 42.5,
            minChargePerMonth: 425,
            logic: 'if (sqm * rate) >= minCharge then bill sqm at rate else bill 1 unit at minCharge'
          }
        }
      },
      metadata: { description: 'Calculate total storage SqM from pallet counts' }
    },

    // Step 9: Calculate EXW (Ex-Works) count
    {
      id: 'calc_exw_count',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'sum_filtered',
        sourceKey: 'vasData',
        field: 'Distinct count of Ref (Orders)',
        filter: { field: 'service_name', equals: 'EXW' },
        outputKey: '__sensos_exw_count'
      },
      metadata: { description: 'Count EXW service orders' }
    },

    // Step 10: Calculate management orders (excluding Lilach Almasi)
    {
      id: 'calc_mgmt_orders',
      type: 'aggregate',
      enabled: true,
      config: {
        operation: 'sum_filtered',
        sourceKey: 'managementData',
        field: 'Distinct count of Ref (Orders)',
        filter: {
          exclude: { field: 'Name (Users)', equals: 'Lilach Almasi' }
        },
        outputKey: '__sensos_management_manual_orders'
      },
      metadata: { description: 'Count manual management orders (excluding service user Lilach Almasi)' }
    },

    // Step 11: Map synthetic quantities to line items
    {
      id: 'map_quantities_inbound',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:inbound & clause:per_order',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_inbound_orders',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map inbound orders count to line items with "per order" clause' }
    },

    {
      id: 'map_quantities_inbound_boxes',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:inbound & clause:per_unit_scan & category:box',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_inbound_boxes',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map inbound box count to line items with "per unit scan" clause' }
    },

    {
      id: 'map_quantities_outbound_dom',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:outbound & clause:per_order & category:domestic',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_outbound_dom_orders',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map domestic outbound orders count' }
    },

    {
      id: 'map_quantities_outbound_int',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:outbound & clause:per_order & category:international',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_outbound_int_orders',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map international outbound orders count' }
    },

    {
      id: 'map_quantities_outbound_boxes',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:outbound & clause:per_unit_scan & category:box',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_outbound_boxes',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map outbound box count' }
    },

    {
      id: 'map_quantities_storage',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:storage & clause:space & category:per_area',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_storage_total_sqm',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map storage SqM (per-area charge)' }
    },

    {
      id: 'map_quantities_storage_minimum',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:storage & clause:space & category:minimum',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: 'storage_minimum_billing_flag',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Determine if minimum storage charge applies (1 if SqM cost < minimum, 0 otherwise)' }
    },

    {
      id: 'map_quantities_exw',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:outbound & clause:vas & category:exw',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_exw_count',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map EXW service count' }
    },

    {
      id: 'map_quantities_management',
      type: 'conditional',
      enabled: true,
      config: {
        condition: 'segment:management & clause:manual',
        ifTrueKey: 'quantity_mapping',
        ifTrueValue: '__sensos_management_manual_orders',
        ifFalseKey: 'skip',
        ifFalseValue: true
      },
      metadata: { description: 'Map manual management order count' }
    }
  ];

  return {
    id: 'rule_sensos_default',
    customer_id: 'Sensos',
    name: 'Sensos Quantity Aggregation & Storage Billing',
    description: 'Default rule for Sensos: calculates 8 synthetic quantities from Tableau views, applies storage SqM logic with minimum charge, maps to line items by segment+clause+category',
    version: 1,
    enabled: false,
    ruleType: 'aggregation',
    steps,
    created_at: new Date().toISOString(),
    created_by: 'migration_script',
    updated_at: new Date().toISOString(),
    updated_by: 'migration_script'
  };
}

/**
 * Details for Sensos Rule Implementation:
 * 
 * RULE TYPE: Aggregation (calculates synthetic quantities, not matching)
 * TRIGGERED BY: Customer name contains "sensos"
 * 
 * SYNTHETIC QUANTITIES:
 * 1. __sensos_inbound_orders: Distinct count of Ref (Orders) from Inbound view
 * 2. __sensos_inbound_boxes: Sum of Distinct count of Id (Billable Scan Logs) from Inbound
 * 3. __sensos_outbound_dom_orders: Distinct Ref where Dom/Int = "local"/"domestic"/"dom"
 * 4. __sensos_outbound_int_orders: Distinct Ref where Dom/Int = "int'l"/"international"/"int"
 * 5. __sensos_outbound_boxes: Sum of Distinct count of Id from Outbound
 * 6. __sensos_storage_total_sqm: max_pallets × 1.5 (storage area in SqM)
 * 7. __sensos_exw_count: Sum of Distinct Ref where service_name = "EXW"
 * 8. __sensos_management_manual_orders: Sum Ref from Management excluding user "Lilach Almasi"
 * 
 * STORAGE BILLING LOGIC (Complex):
 * - Per-area rate: $42.5/SqM
 * - Minimum charge: $425/month
 * - If (SqM × $42.5) >= $425: Bill SqM at per-area rate
 * - If (SqM × $42.5) < $425: Bill 1 unit at minimum rate (must be separate line item)
 * 
 * LINE ITEM MAPPING:
 * - Matches on segment + clause + category
 * - Examples:
 *   • "Inbound" + "per order" → __sensos_inbound_orders
 *   • "Inbound" + "per unit scan" + "box" → __sensos_inbound_boxes
 *   • "Storage" + "space" + "per area" → __sensos_storage_total_sqm
 *   • "Storage" + "space" + "minimum" → 1 or 0 (based on cost vs minimum)
 *   • "Management" + "manual" → __sensos_management_manual_orders
 *   • "Outbound" + "VAS" + "EXW" → __sensos_exw_count
 */
