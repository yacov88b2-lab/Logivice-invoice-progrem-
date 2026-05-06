/**
 * Integration Test: Rule Engine with Database Persistence
 * 
 * Tests the full pipeline:
 * 1. Create rule in database
 * 2. Load rule from database
 * 3. Execute rule against test data
 * 4. Log results to rule_test_runs table
 * 5. Verify audit trail
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RuleEngine, type CustomerRuleDefinition } from '../services/RuleEngine';
import { CustomerRuleModel } from '../models/CustomerRule';
import type { Transaction, LineItem } from '../types';
import db from '../db';

describe('RuleEngine Integration Tests', () => {
  let engine: RuleEngine;
  let testCustomerId: string;

  beforeEach(() => {
    engine = new RuleEngine();
    testCustomerId = `test_customer_${Date.now()}`;
  });

  afterEach(() => {
    // Clean up test data
    db.prepare('DELETE FROM customer_rules WHERE customer_id = ?').run(testCustomerId);
    db.prepare('DELETE FROM rule_test_runs WHERE created_by = ?').run('integration_test');
  });

  describe('Full Pipeline: Create → Load → Execute → Audit', () => {
    it('should create, load, and execute rule with full audit trail', async () => {
      // Step 1: Create rule definition
      const ruleDefinition: CustomerRuleDefinition = {
        customer_id: testCustomerId,
        name: 'Integration Test Rule',
        description: 'Test rule for full pipeline',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: [
          {
            id: 'step1',
            type: 'field_extraction',
            enabled: true,
            config: {
              fieldName: 'segment',
              outputKey: 'extracted_segment',
              transformType: 'uppercase'
            }
          },
          {
            id: 'step2',
            type: 'match_transaction',
            enabled: true,
            config: {
              matchFields: ['segment'],
              conflictResolution: 'first_match'
            }
          }
        ]
      };

      // Step 2: Save rule to database
      const savedRule = CustomerRuleModel.create(ruleDefinition);
      expect(savedRule.id).toBeDefined();
      expect(savedRule.customer_id).toBe(testCustomerId);
      expect(savedRule.version).toBe(1);

      // Step 3: Load rule from database
      const loadedRule = CustomerRuleModel.getById(savedRule.id!);
      expect(loadedRule).toBeDefined();
      expect(loadedRule!.steps).toHaveLength(2);
      expect(loadedRule!.enabled).toBe(true);

      // Step 4: Prepare test data
      const testTransaction: Transaction = {
        id: 'txn_001',
        date: '2024-01-15',
        segment: 'Inbound',
        clause: 'per order',
        category: 'box',
        amount: 150.00,
        ref: 'REF-001',
        description: 'Test inbound',
        custom: {}
      };

      const testLineItems: LineItem[] = [
        {
          id: 'li_001',
          segment: 'Inbound',
          clause: 'per order',
          category: 'box',
          description: 'Inbound handling',
          uom: 'Order',
          quantity: 0,
          unitPrice: 25.00,
          total: 0,
          custom: {}
        }
      ];

      // Step 5: Execute rule
      const executionResult = await engine.evaluateRule(loadedRule!, {
        transaction: testTransaction,
        lineItems: testLineItems,
        templateStructure: { sheets: [], columns: [], headers: [] },
        customData: {},
        previousResults: {}
      });

      expect(executionResult.success).toBe(true);
      expect(executionResult.data.extracted_segment).toBe('INBOUND');
      expect(executionResult.data.matchedLineItem).toBeDefined();

      // Step 6: Log test run to database
      const testRunId = `run_${Date.now()}`;
      db.prepare(`
        INSERT INTO rule_test_runs (
          id, rule_id, test_data, result_data, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        testRunId,
        savedRule.id,
        JSON.stringify({ transaction: testTransaction, lineItems: testLineItems }),
        JSON.stringify(executionResult),
        'passed',
        'integration_test'
      );

      // Step 7: Verify test run was logged
      const testRun = db.prepare('SELECT * FROM rule_test_runs WHERE id = ?').get(testRunId);
      expect(testRun).toBeDefined();
      expect(testRun.status).toBe('passed');

      // Step 8: Verify audit trail
      const auditEntries = db.prepare(`
        SELECT * FROM rule_audit_log WHERE rule_id = ? ORDER BY created_at DESC
      `).all(savedRule.id);
      
      expect(auditEntries.length).toBeGreaterThan(0);
      expect(auditEntries[0].action).toBe('created');
    });

    it('should create multiple versions of same rule', async () => {
      // Create initial rule
      const rule1: CustomerRuleDefinition = {
        customer_id: testCustomerId,
        name: 'Versioned Rule',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: [
          {
            id: 'step1',
            type: 'field_extraction',
            enabled: true,
            config: { fieldName: 'segment', outputKey: 'seg', transformType: 'none' }
          }
        ]
      };

      const saved1 = CustomerRuleModel.create(rule1);
      expect(saved1.version).toBe(1);

      // Create new version based on first
      const rule2 = { ...saved1, version: 2, enabled: false };
      const saved2 = CustomerRuleModel.create(rule2);
      expect(saved2.version).toBe(2);
      expect(saved2.enabled).toBe(false);

      // Get all versions
      const allVersions = CustomerRuleModel.getByCustomer(testCustomerId);
      expect(allVersions.length).toBe(2);
      expect(allVersions[0].version).toBe(1);
      expect(allVersions[1].version).toBe(2);

      // Only v1 should be active
      const active = CustomerRuleModel.getActiveByCustomer(testCustomerId);
      expect(active!.version).toBe(1);
    });

    it('should update rule and log changes', async () => {
      // Create rule
      const initial: CustomerRuleDefinition = {
        customer_id: testCustomerId,
        name: 'Original Name',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: []
      };

      const saved = CustomerRuleModel.create(initial);

      // Update rule
      const updates = {
        name: 'Updated Name',
        description: 'New description'
      };

      CustomerRuleModel.update(saved.id!, updates);

      // Load updated rule
      const loaded = CustomerRuleModel.getById(saved.id!);
      expect(loaded!.name).toBe('Updated Name');
      expect(loaded!.description).toBe('New description');

      // Verify audit log
      const auditEntries = db.prepare(`
        SELECT * FROM rule_audit_log WHERE rule_id = ? ORDER BY created_at
      `).all(saved.id);

      expect(auditEntries.length).toBeGreaterThan(1);
      const updateEntry = auditEntries.find((e: any) => e.action === 'updated');
      expect(updateEntry).toBeDefined();
    });

    it('should toggle rule enabled status', async () => {
      // Create enabled rule
      const rule: CustomerRuleDefinition = {
        customer_id: testCustomerId,
        name: 'Toggle Test',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: []
      };

      const saved = CustomerRuleModel.create(rule);
      expect(saved.enabled).toBe(true);

      // Disable rule
      CustomerRuleModel.update(saved.id!, { enabled: false });
      let loaded = CustomerRuleModel.getById(saved.id!);
      expect(loaded!.enabled).toBe(false);

      // Re-enable rule
      CustomerRuleModel.update(saved.id!, { enabled: true });
      loaded = CustomerRuleModel.getById(saved.id!);
      expect(loaded!.enabled).toBe(true);

      // Verify audit
      const auditEntries = db.prepare(`
        SELECT * FROM rule_audit_log WHERE rule_id = ? ORDER BY created_at
      `).all(saved.id);

      const disabledEntry = auditEntries.find((e: any) => e.action === 'disabled');
      const enabledEntry = auditEntries.find((e: any) => e.action === 'enabled');
      expect(disabledEntry).toBeDefined();
      expect(enabledEntry).toBeDefined();
    });

    it('should handle multi-customer isolation', async () => {
      const customerId1 = `customer_1_${Date.now()}`;
      const customerId2 = `customer_2_${Date.now()}`;

      // Create rules for different customers
      const rule1: CustomerRuleDefinition = {
        customer_id: customerId1,
        name: 'Rule for Customer 1',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: []
      };

      const rule2: CustomerRuleDefinition = {
        customer_id: customerId2,
        name: 'Rule for Customer 2',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: []
      };

      const saved1 = CustomerRuleModel.create(rule1);
      const saved2 = CustomerRuleModel.create(rule2);

      // Get rules by customer
      const customer1Rules = CustomerRuleModel.getByCustomer(customerId1);
      const customer2Rules = CustomerRuleModel.getByCustomer(customerId2);

      expect(customer1Rules).toHaveLength(1);
      expect(customer2Rules).toHaveLength(1);
      expect(customer1Rules[0].customer_id).toBe(customerId1);
      expect(customer2Rules[0].customer_id).toBe(customerId2);

      // Clean up
      db.prepare('DELETE FROM customer_rules WHERE customer_id IN (?, ?)').run(customerId1, customerId2);
    });

    it('should execute complex multi-step rule', async () => {
      const complexRule: CustomerRuleDefinition = {
        customer_id: testCustomerId,
        name: 'Complex Multi-Step',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: [
          {
            id: 'step1',
            type: 'field_extraction',
            enabled: true,
            config: {
              fieldName: 'segment',
              outputKey: 'segment_upper',
              transformType: 'uppercase'
            }
          },
          {
            id: 'step2',
            type: 'filter',
            enabled: true,
            config: {
              field: 'segment_upper',
              operator: 'equals',
              value: 'INBOUND'
            }
          },
          {
            id: 'step3',
            type: 'field_extraction',
            enabled: true,
            config: {
              fieldName: 'amount',
              outputKey: 'amount_value',
              transformType: 'none'
            }
          },
          {
            id: 'step4',
            type: 'filter',
            enabled: true,
            config: {
              field: 'amount_value',
              operator: 'gt',
              value: 100
            }
          },
          {
            id: 'step5',
            type: 'match_transaction',
            enabled: true,
            config: {
              matchFields: ['segment'],
              conflictResolution: 'first_match'
            }
          }
        ]
      };

      const saved = CustomerRuleModel.create(complexRule);

      const testData = {
        transaction: {
          id: 'txn_001',
          date: '2024-01-15',
          segment: 'Inbound',
          amount: 150,
          ref: 'REF-001',
          description: 'Test',
          custom: {}
        },
        lineItems: [
          {
            id: 'li_001',
            segment: 'Inbound',
            description: 'Inbound service',
            uom: 'Order',
            quantity: 0,
            unitPrice: 25,
            total: 0,
            custom: {}
          }
        ],
        templateStructure: { sheets: [], columns: [], headers: [] },
        customData: {},
        previousResults: {}
      };

      const result = await engine.evaluateRule(saved, testData as any);

      expect(result.success).toBe(true);
      expect(result.executedSteps).toBe(5);
      expect(result.data.segment_upper).toBe('INBOUND');
      expect(result.data.passFilter).toBe(true); // Last filter passed
      expect(result.data.matchedLineItem).toBeDefined();
    });
  });

  describe('Error Recovery', () => {
    it('should continue execution after step with warnings', async () => {
      const rule: CustomerRuleDefinition = {
        customer_id: testCustomerId,
        name: 'Continue on Warning',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: [
          {
            id: 'step1',
            type: 'field_extraction',
            enabled: true,
            config: {
              fieldName: 'nonexistent',
              outputKey: 'result1',
              transformType: 'none'
            }
          },
          {
            id: 'step2',
            type: 'field_extraction',
            enabled: true,
            config: {
              fieldName: 'segment',
              outputKey: 'result2',
              transformType: 'none'
            }
          }
        ]
      };

      const saved = CustomerRuleModel.create(rule);
      const testData = {
        transaction: { id: 'txn_001', segment: 'Inbound', custom: {} },
        lineItems: [],
        templateStructure: { sheets: [], columns: [], headers: [] },
        customData: {},
        previousResults: {}
      };

      const result = await engine.evaluateRule(saved, testData as any);

      // Should continue despite first step error
      expect(result.data.result2).toBe('Inbound');
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
