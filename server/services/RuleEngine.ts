import type { Transaction, LineItem, TemplateStructure } from '../types';

// Rule step types and configuration
export type RuleStepType =
  | 'field_extraction'
  | 'field_transform'
  | 'match_transaction'
  | 'fuzzy_match'
  | 'filter'
  | 'aggregate'
  | 'conditional';

export interface RuleStep {
  id: string;
  type: RuleStepType;
  enabled: boolean;
  config: Record<string, any>;
  metadata?: {
    description?: string;
    tags?: string[];
  };
}

export interface CustomerRuleDefinition {
  id: string;
  customer_id: string;
  name: string;
  description?: string;
  version: number;
  enabled: boolean;
  ruleType: 'matching' | 'transformation' | 'aggregation'; // Primary rule category
  steps: RuleStep[];
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface RuleEvaluationContext {
  transaction?: Transaction;
  lineItems?: LineItem[];
  templateStructure?: TemplateStructure;
  customData?: Record<string, any>;
  previousResults?: Record<string, any>;
}

export interface RuleEvaluationResult {
  success: boolean;
  data: Record<string, any>;
  errors: string[];
  warnings: string[];
  matchedItems?: LineItem[];
  confidenceScores?: Map<string, number>;
  executedSteps: string[];
}

export class RuleEngine {
  private static readonly CONFIDENCE_THRESHOLD = 0.7;
  private static readonly FUZZY_WEIGHTS = {
    segment: 0.5,
    clause: 0.4,
    category: 0.2,
    unitOfMeasure: 0.2,
    description: 0.2
  };

  /**
   * Evaluate a customer rule against transaction data
   */
  static async evaluateRule(
    rule: CustomerRuleDefinition,
    context: RuleEvaluationContext
  ): Promise<RuleEvaluationResult> {
    if (!rule.enabled) {
      return {
        success: false,
        data: {},
        errors: ['Rule is disabled'],
        warnings: [],
        executedSteps: []
      };
    }

    const result: RuleEvaluationResult = {
      success: true,
      data: {},
      errors: [],
      warnings: [],
      executedSteps: [],
      matchedItems: [],
      confidenceScores: new Map()
    };

    try {
      let stepContext = context;

      for (const step of rule.steps) {
        if (!step.enabled) continue;

        try {
          const stepResult = await this.executeStep(step, stepContext, context);
          result.data = { ...result.data, ...stepResult.data };
          result.executedSteps.push(step.id);

          if (stepResult.errors.length > 0) {
            result.errors.push(...stepResult.errors);
          }
          if (stepResult.warnings.length > 0) {
            result.warnings.push(...stepResult.warnings);
          }

          // Update context for next step
          stepContext = {
            ...stepContext,
            previousResults: result.data
          };
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          result.errors.push(`Step ${step.id} failed: ${err}`);
          result.success = false;
        }
      }

      return result;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        data: {},
        errors: [err],
        warnings: [],
        executedSteps: result.executedSteps
      };
    }
  }

  private static async executeStep(
    step: RuleStep,
    context: RuleEvaluationContext,
    originalContext: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    switch (step.type) {
      case 'field_extraction':
        return this.executeFieldExtraction(step, context);
      case 'field_transform':
        return this.executeFieldTransform(step, context);
      case 'match_transaction':
        return this.executeMatchTransaction(step, context);
      case 'fuzzy_match':
        return this.executeFuzzyMatch(step, context);
      case 'filter':
        return this.executeFilter(step, context);
      case 'aggregate':
        return this.executeAggregate(step, context);
      case 'conditional':
        return this.executeConditional(step, context);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private static async executeFieldExtraction(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { fieldName, outputKey, transformType = 'none' } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = {};

    if (!context.transaction) {
      errors.push('No transaction data available');
      return { data, errors, warnings };
    }

    let value = this.getFieldValue(context.transaction, fieldName);

    if (transformType === 'uppercase') value = String(value).toUpperCase();
    else if (transformType === 'lowercase') value = String(value).toLowerCase();
    else if (transformType === 'trim') value = String(value).trim();
    else if (transformType === 'parse_date') {
      value = this.parseTableauDate(value);
      if (!value) warnings.push(`Could not parse date from ${fieldName}`);
    }

    data[outputKey] = value;
    return { data, errors, warnings };
  }

  private static async executeFieldTransform(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { sourceKey, operation, targetKey } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = {};

    const sourceValue = context.previousResults?.[sourceKey];
    if (sourceValue === undefined) {
      errors.push(`Source key ${sourceKey} not found in context`);
      return { data, errors, warnings };
    }

    let result = sourceValue;

    switch (operation) {
      case 'uppercase':
        result = String(result).toUpperCase();
        break;
      case 'lowercase':
        result = String(result).toLowerCase();
        break;
      case 'trim':
        result = String(result).trim();
        break;
      case 'replace':
        const { pattern, replacement } = step.config;
        result = String(result).replace(new RegExp(pattern, 'g'), replacement);
        break;
      case 'substring':
        const { start, length } = step.config;
        result = String(result).substring(start, start + length);
        break;
      default:
        errors.push(`Unknown operation: ${operation}`);
    }

    data[targetKey] = result;
    return { data, errors, warnings };
  }

  private static async executeMatchTransaction(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { matchFields, conflictResolution = 'first_match' } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = { matches: [], unmatched: [] };

    if (!context.transaction || !context.lineItems) {
      errors.push('Transaction or line items not available');
      return { data, errors, warnings };
    }

    // Create composite match key from specified fields
    const transactionKey = matchFields
      .map((f: string) => this.normalize(this.getFieldValue(context.transaction, f)))
      .join('|');

    const matches = context.lineItems.filter(item => {
      const itemKey = matchFields
        .map((f: string) => {
          if (f === 'segment') return this.normalize(item.segment);
          if (f === 'clause') return this.normalize(item.clause);
          if (f === 'category') return this.normalize(item.category);
          if (f === 'unitOfMeasure') return this.normalize(item.unitOfMeasure);
          if (f === 'remark') return this.normalize(item.remark);
          return '';
        })
        .join('|');

      return transactionKey === itemKey;
    });

    if (matches.length === 1) {
      data.matches = [{ item: matches[0], confidence: 1.0, reason: 'Exact match' }];
    } else if (matches.length > 1) {
      if (conflictResolution === 'first_match') {
        data.matches = [{ item: matches[0], confidence: 1.0, reason: 'First of multiple exact matches' }];
        warnings.push(`Multiple exact matches found, using first match`);
      } else {
        data.unmatched = [{ reason: 'Multiple exact matches (ambiguous)' }];
      }
    } else {
      data.unmatched = [{ reason: 'No exact matches found' }];
    }

    return { data, errors, warnings };
  }

  private static async executeFuzzyMatch(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { matchFields, threshold = 0.7 } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = { matches: [], unmatched: [] };

    if (!context.transaction || !context.lineItems) {
      errors.push('Transaction or line items not available');
      return { data, errors, warnings };
    }

    const scored = context.lineItems.map(item => {
      let score = 0;

      for (const field of matchFields) {
        const transValue = this.normalize(this.getFieldValue(context.transaction, field));
        let itemValue = '';

        if (field === 'segment') itemValue = this.normalize(item.segment);
        else if (field === 'clause') itemValue = this.normalize(item.clause);
        else if (field === 'category') itemValue = this.normalize(item.category);
        else if (field === 'unitOfMeasure') itemValue = this.normalize(item.unitOfMeasure);
        else if (field === 'remark') itemValue = this.normalize(item.remark);

        const weight = this.FUZZY_WEIGHTS[field as keyof typeof this.FUZZY_WEIGHTS] || 0.1;
        if (transValue === itemValue || transValue.includes(itemValue) || itemValue.includes(transValue)) {
          score += weight;
        }
      }

      return { item, score };
    });

    const qualified = scored
      .filter(s => s.score >= threshold)
      .sort((a, b) => b.score - a.score);

    if (qualified.length === 0) {
      data.unmatched = [{ reason: `No fuzzy matches above threshold ${threshold}` }];
    } else if (qualified.length === 1) {
      data.matches = [{ item: qualified[0].item, confidence: qualified[0].score, reason: 'Fuzzy match' }];
    } else if (qualified[0].score - qualified[1].score > 0.2) {
      data.matches = [{ item: qualified[0].item, confidence: qualified[0].score, reason: 'Best fuzzy match' }];
    } else {
      // Multiple close matches
      data.matches = qualified.slice(0, 3).map(q => ({
        item: q.item,
        confidence: q.score,
        reason: 'Multiple fuzzy matches available'
      }));
      warnings.push(`Multiple close fuzzy matches (user review recommended)`);
    }

    return { data, errors, warnings };
  }

  private static async executeFilter(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { field, operator, value } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = {};

    if (!context.transaction) {
      errors.push('No transaction data');
      return { data, errors, warnings };
    }

    const fieldValue = this.getFieldValue(context.transaction, field);
    let passes = false;

    switch (operator) {
      case 'equals':
        passes = fieldValue === value;
        break;
      case 'contains':
        passes = String(fieldValue).includes(String(value));
        break;
      case 'gt':
        passes = Number(fieldValue) > Number(value);
        break;
      case 'lt':
        passes = Number(fieldValue) < Number(value);
        break;
      case 'gte':
        passes = Number(fieldValue) >= Number(value);
        break;
      case 'lte':
        passes = Number(fieldValue) <= Number(value);
        break;
      default:
        errors.push(`Unknown operator: ${operator}`);
    }

    data.passes = passes;
    if (!passes) {
      warnings.push(`Filter failed: ${field} ${operator} ${value}`);
    }

    return { data, errors, warnings };
  }

  private static async executeAggregate(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { operation, outputKey, groupBy } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = {};

    if (!context.previousResults) {
      errors.push('No previous results to aggregate');
      return { data, errors, warnings };
    }

    // Simple aggregation for now (sum, count, distinct)
    let result = 0;

    if (operation === 'sum') {
      result = Object.values(context.previousResults).reduce((sum: number, val: any) => {
        return sum + (Number(val) || 0);
      }, 0);
    } else if (operation === 'count') {
      result = Object.keys(context.previousResults).length;
    } else if (operation === 'distinct') {
      const set = new Set(Object.values(context.previousResults));
      result = set.size;
    }

    data[outputKey] = result;
    return { data, errors, warnings };
  }

  private static async executeConditional(
    step: RuleStep,
    context: RuleEvaluationContext
  ): Promise<{ data: Record<string, any>; errors: string[]; warnings: string[] }> {
    const { condition, ifTrueKey, ifTrueValue, ifFalseKey, ifFalseValue } = step.config;
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: Record<string, any> = {};

    // Simple condition evaluation
    let conditionMet = false;

    if (typeof condition === 'string') {
      // Evaluate condition using previous results
      conditionMet = context.previousResults?.[condition] === true;
    }

    if (conditionMet) {
      data[ifTrueKey] = ifTrueValue;
    } else {
      data[ifFalseKey] = ifFalseValue;
    }

    return { data, errors, warnings };
  }

  // Helper methods
  private static getFieldValue(obj: any, fieldName: string): any {
    if (!obj || !fieldName) return undefined;
    if (obj.hasOwnProperty(fieldName)) return obj[fieldName];

    const target = String(fieldName).toLowerCase().trim();
    const key = Object.keys(obj).find(k => String(k).toLowerCase().trim() === target);
    return key ? obj[key] : undefined;
  }

  private static normalize(str: string): string {
    let s = String(str).toLowerCase().trim().replace(/\s+/g, ' ');
    if (s === 'general' || s === 'regular') s = 'general';
    return s;
  }

  private static parseTableauDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 20000 && value < 80000) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + value * 86400000);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value > 1000000000000) {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
      }
      if (value > 1000000000) {
        const d = new Date(value * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
    }
    const s = String(value).trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d2 = new Date(s);
    return isNaN(d2.getTime()) ? null : d2;
  }
}