import { describe, it, expect, beforeEach } from 'vitest';
import { RuleEngine, type RuleStep, type RuleEvaluationContext, type CustomerRuleDefinition } from '../services/RuleEngine';
import type { Transaction, LineItem } from '../types';

describe('RuleEngine', () => {
  let engine: RuleEngine;
  let mockContext: RuleEvaluationContext;

  beforeEach(() => {
    engine = new RuleEngine();

    mockContext = {
      transaction: {
        id: 'txn_001',
        date: '2024-01-15',
        segment: 'Inbound',
        clause: 'per order',
        category: 'box',
        amount: 150.00,
        ref: 'REF-12345',
        description: 'Inbound scan',
        custom: {}
      } as Transaction,
      lineItems: [
        {
          id: 'li_001',
          segment: 'inbound',
          clause: 'per order',
          category: 'box',
          description: 'Per order inbound handling',
          uom: 'Order',
          quantity: 0,
          unitPrice: 25.00,
          total: 0,
          custom: {}
        }
      ] as LineItem[],
      templateStructure: {
        sheets: ['Sheet1', 'Sheet2'],
        columns: ['A', 'B', 'C'],
        headers: ['Name', 'Qty', 'Price']
      },
      customData: {},
      previousResults: {}
    };
  });

  describe('executeFieldExtraction', () => {
    it('should extract a field from transaction', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          fieldName: 'segment',
          outputKey: 'extractedSegment',
          transformType: 'uppercase'
        }
      };

      const result = await engine.executeStep(step, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.extractedSegment).toBe('INBOUND');
    });

    it('should handle case-insensitive field lookup', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          fieldName: 'SEGMENT',
          outputKey: 'result',
          transformType: 'none'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.result).toBe('Inbound');
    });

    it('should apply lowercase transform', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          fieldName: 'segment',
          outputKey: 'result',
          transformType: 'lowercase'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.result).toBe('inbound');
    });

    it('should apply trim transform', async () => {
      mockContext.transaction.segment = '  Inbound  ';
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          fieldName: 'segment',
          outputKey: 'result',
          transformType: 'trim'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.result).toBe('Inbound');
    });

    it('should parse ISO date', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          fieldName: 'date',
          outputKey: 'result',
          transformType: 'parse_date'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.result).toMatch(/2024-01-15|January 15, 2024/);
    });

    it('should report error for missing field', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          fieldName: 'nonexistent',
          outputKey: 'result',
          transformType: 'none'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('executeFieldTransform', () => {
    it('should transform a value with operation', async () => {
      mockContext.previousResults = { sourceData: 'hello world' };
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_transform',
        enabled: true,
        config: {
          sourceKey: 'sourceData',
          operation: 'uppercase',
          targetKey: 'result'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.result).toBe('HELLO WORLD');
    });

    it('should apply substring operation', async () => {
      mockContext.previousResults = { sourceData: 'ABCDEF123' };
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_transform',
        enabled: true,
        config: {
          sourceKey: 'sourceData',
          operation: 'substring',
          targetKey: 'result',
          start: 0,
          length: 3
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.result).toBe('ABC');
    });

    it('should apply replace operation', async () => {
      mockContext.previousResults = { sourceData: 'foo-bar-baz' };
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_transform',
        enabled: true,
        config: {
          sourceKey: 'sourceData',
          operation: 'replace',
          targetKey: 'result',
          search: '-',
          replacement: '_'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.result).toBe('foo_bar_baz');
    });
  });

  describe('executeMatchTransaction', () => {
    it('should match transaction to line item by exact fields', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'match_transaction',
        enabled: true,
        config: {
          matchFields: ['segment', 'clause', 'category'],
          conflictResolution: 'first_match'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.matchedLineItem).toBeDefined();
      expect(result.data.matchedLineItem.id).toBe('li_001');
    });

    it('should return no match for non-matching fields', async () => {
      mockContext.transaction.segment = 'Outbound';
      const step: RuleStep = {
        id: 'test_step',
        type: 'match_transaction',
        enabled: true,
        config: {
          matchFields: ['segment', 'clause', 'category'],
          conflictResolution: 'first_match'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.matchedLineItem).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle case-insensitive matching', async () => {
      mockContext.transaction.segment = 'INBOUND';
      mockContext.lineItems[0].segment = 'Inbound';
      const step: RuleStep = {
        id: 'test_step',
        type: 'match_transaction',
        enabled: true,
        config: {
          matchFields: ['segment'],
          conflictResolution: 'first_match'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.matchedLineItem).toBeDefined();
    });
  });

  describe('executeFuzzyMatch', () => {
    it('should score and match with threshold', async () => {
      mockContext.transaction.description = 'Inbound order handling box';
      mockContext.lineItems = [
        {
          id: 'li_001',
          description: 'inbound order handling box',
          segment: 'inbound',
          clause: 'per order',
          category: 'box',
          uom: 'Order',
          quantity: 0,
          unitPrice: 25,
          total: 0,
          custom: {}
        } as LineItem
      ];

      const step: RuleStep = {
        id: 'test_step',
        type: 'fuzzy_match',
        enabled: true,
        config: {
          matchFields: ['description'],
          threshold: 0.6
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.matchScore).toBeGreaterThan(0.6);
    });

    it('should reject match below threshold', async () => {
      mockContext.transaction.description = 'Unrelated data';
      mockContext.lineItems[0].description = 'inbound order handling';

      const step: RuleStep = {
        id: 'test_step',
        type: 'fuzzy_match',
        enabled: true,
        config: {
          matchFields: ['description'],
          threshold: 0.9
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.matchedLineItem).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('executeFilter', () => {
    it('should filter with equals operator', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'filter',
        enabled: true,
        config: {
          field: 'segment',
          operator: 'equals',
          value: 'Inbound'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.passFilter).toBe(true);
    });

    it('should filter with contains operator', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'filter',
        enabled: true,
        config: {
          field: 'ref',
          operator: 'contains',
          value: '123'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.passFilter).toBe(true);
    });

    it('should filter with numeric operators', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'filter',
        enabled: true,
        config: {
          field: 'amount',
          operator: 'gt',
          value: 100
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.passFilter).toBe(true);
    });

    it('should reject non-matching filter', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'filter',
        enabled: true,
        config: {
          field: 'segment',
          operator: 'equals',
          value: 'Outbound'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.passFilter).toBe(false);
    });
  });

  describe('executeAggregate', () => {
    it('should sum values', async () => {
      mockContext.previousResults = { values: [10, 20, 30] };
      const step: RuleStep = {
        id: 'test_step',
        type: 'aggregate',
        enabled: true,
        config: {
          operation: 'sum',
          sourceKey: 'values',
          outputKey: 'total'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.total).toBe(60);
    });

    it('should count values', async () => {
      mockContext.previousResults = { values: [1, 2, 3, 4, 5] };
      const step: RuleStep = {
        id: 'test_step',
        type: 'aggregate',
        enabled: true,
        config: {
          operation: 'count',
          sourceKey: 'values',
          outputKey: 'count'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.count).toBe(5);
    });

    it('should deduplicate values', async () => {
      mockContext.previousResults = { values: ['a', 'b', 'a', 'c', 'b'] };
      const step: RuleStep = {
        id: 'test_step',
        type: 'aggregate',
        enabled: true,
        config: {
          operation: 'distinct',
          sourceKey: 'values',
          outputKey: 'unique'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.unique.length).toBe(3);
      expect(result.data.unique).toContain('a');
      expect(result.data.unique).toContain('b');
      expect(result.data.unique).toContain('c');
    });
  });

  describe('executeConditional', () => {
    it('should execute if-true branch', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'conditional',
        enabled: true,
        config: {
          condition: 'segment:Inbound',
          ifTrueKey: 'action',
          ifTrueValue: 'handle_inbound',
          ifFalseKey: 'action',
          ifFalseValue: 'skip'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.action).toBe('handle_inbound');
    });

    it('should execute if-false branch', async () => {
      mockContext.transaction.segment = 'Outbound';
      const step: RuleStep = {
        id: 'test_step',
        type: 'conditional',
        enabled: true,
        config: {
          condition: 'segment:Inbound',
          ifTrueKey: 'action',
          ifTrueValue: 'handle_inbound',
          ifFalseKey: 'action',
          ifFalseValue: 'handle_outbound'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.data.action).toBe('handle_outbound');
    });
  });

  describe('evaluateRule', () => {
    it('should execute multi-step rule', async () => {
      const rule: CustomerRuleDefinition = {
        id: 'rule_001',
        customer_id: 'test',
        name: 'Test Rule',
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
            type: 'filter',
            enabled: true,
            config: {
              field: 'extracted_segment',
              operator: 'equals',
              value: 'INBOUND'
            }
          }
        ]
      };

      const result = await engine.evaluateRule(rule, mockContext);
      expect(result.success).toBe(true);
      expect(result.executedSteps).toBe(2);
      expect(result.data.extracted_segment).toBe('INBOUND');
      expect(result.data.passFilter).toBe(true);
    });

    it('should disable rule if not enabled', async () => {
      const rule: CustomerRuleDefinition = {
        id: 'rule_001',
        customer_id: 'test',
        name: 'Test Rule',
        version: 1,
        enabled: false,
        ruleType: 'matching',
        steps: []
      };

      const result = await engine.evaluateRule(rule, mockContext);
      expect(result.success).toBe(false);
      expect(result.warnings[0]).toContain('disabled');
    });

    it('should skip disabled steps', async () => {
      const rule: CustomerRuleDefinition = {
        id: 'rule_001',
        customer_id: 'test',
        name: 'Test Rule',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: [
          {
            id: 'step1',
            type: 'field_extraction',
            enabled: false,
            config: { fieldName: 'segment', outputKey: 'result', transformType: 'none' }
          },
          {
            id: 'step2',
            type: 'field_extraction',
            enabled: true,
            config: { fieldName: 'ref', outputKey: 'reference', transformType: 'none' }
          }
        ]
      };

      const result = await engine.evaluateRule(rule, mockContext);
      expect(result.success).toBe(true);
      expect(result.data.result).toBeUndefined();
      expect(result.data.reference).toBe('REF-12345');
    });
  });

  describe('error handling', () => {
    it('should report errors for invalid step config', async () => {
      const step: RuleStep = {
        id: 'test_step',
        type: 'field_extraction',
        enabled: true,
        config: {
          // Missing required fieldName
          outputKey: 'result',
          transformType: 'none'
        }
      };

      const result = await engine.executeStep(step, mockContext);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accumulate errors from multiple steps', async () => {
      const rule: CustomerRuleDefinition = {
        id: 'rule_001',
        customer_id: 'test',
        name: 'Test Rule',
        version: 1,
        enabled: true,
        ruleType: 'matching',
        steps: [
          {
            id: 'step1',
            type: 'field_extraction',
            enabled: true,
            config: { outputKey: 'result', transformType: 'none' }
          },
          {
            id: 'step2',
            type: 'field_extraction',
            enabled: true,
            config: { fieldName: 'nonexistent', outputKey: 'result2', transformType: 'none' }
          }
        ]
      };

      const result = await engine.evaluateRule(rule, mockContext);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
