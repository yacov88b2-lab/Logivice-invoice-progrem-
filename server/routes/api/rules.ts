import express from 'express';
import { CustomerRuleModel } from '../../models/CustomerRule';
import { RuleEngine, type CustomerRuleDefinition, type RuleEvaluationContext } from '../../services/RuleEngine';
import db from '../../db';

const router = express.Router();

// Get all rules (with filtering)
router.get('/', (req, res) => {
  try {
    const { customer_id, enabled } = req.query;
    let rules: CustomerRuleDefinition[] = [];

    if (customer_id) {
      rules = CustomerRuleModel.getByCustomer(String(customer_id));
    } else {
      rules = CustomerRuleModel.getAll();
    }

    if (enabled !== undefined) {
      const enabledFilter = enabled === 'true';
      rules = rules.filter(r => r.enabled === enabledFilter);
    }

    res.json(rules);
  } catch (error) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules', details: (error as Error).message });
  }
});

// Get rule by ID
router.get('/:id', (req, res) => {
  try {
    const rule = CustomerRuleModel.getById(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json(rule);
  } catch (error) {
    console.error('Error fetching rule:', error);
    res.status(500).json({ error: 'Failed to fetch rule', details: (error as Error).message });
  }
});

// Get active rule for customer
router.get('/customer/:customer_id/active', (req, res) => {
  try {
    const rule = CustomerRuleModel.getActiveByCustomer(req.params.customer_id);
    if (!rule) {
      return res.status(404).json({ error: 'No active rule found' });
    }
    res.json(rule);
  } catch (error) {
    console.error('Error fetching active rule:', error);
    res.status(500).json({ error: 'Failed to fetch active rule', details: (error as Error).message });
  }
});

// Create new rule
router.post('/', (req, res) => {
  try {
    const { customer_id, name, description, ruleType, steps, created_by } = req.body;

    if (!customer_id || !name || !ruleType) {
      return res.status(400).json({ error: 'Missing required fields: customer_id, name, ruleType' });
    }

    const rule = CustomerRuleModel.create({
      customer_id,
      name,
      description,
      version: 1,
      enabled: false,
      ruleType,
      steps: steps || [],
      created_by: created_by || 'admin'
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error('Error creating rule:', error);
    res.status(500).json({ error: 'Failed to create rule', details: (error as Error).message });
  }
});

// Update rule
router.put('/:id', (req, res) => {
  try {
    const { name, description, version, enabled, steps, ruleType, updated_by } = req.body;
    const ruleId = req.params.id;

    const oldRule = CustomerRuleModel.getById(ruleId);
    if (!oldRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Active rules must be copied, not edited in place
    if (oldRule.enabled) {
      return res.status(409).json({
        error: 'active_rule_edit_blocked',
        message: 'Active rules cannot be edited directly. Disable it first, or create a draft copy.',
      });
    }

    const newSteps    = steps    !== undefined ? steps    : oldRule.steps;
    const newRuleType = ruleType !== undefined ? ruleType : oldRule.ruleType;

    // Detect whether billing logic actually changed
    const stepsChanged   = JSON.stringify(newSteps) !== JSON.stringify(oldRule.steps);
    const typeChanged    = newRuleType !== oldRule.ruleType;
    const contentChanged = stepsChanged || typeChanged;

    // Non-draft rule with changed logic must restart the approval lifecycle
    const shouldResetApproval = contentChanged && oldRule.approval_status !== 'draft';

    const updated = CustomerRuleModel.update(ruleId, {
      name:            name        || oldRule.name,
      description:     description !== undefined ? description : oldRule.description,
      version:         version     || oldRule.version,
      ruleType:        newRuleType,
      steps:           newSteps,
      enabled:         shouldResetApproval ? false : (enabled !== undefined ? enabled : oldRule.enabled),
      approval_status: shouldResetApproval ? 'draft' : undefined,
      updated_by:      updated_by  || 'admin',
    });

    if (updated) {
      res.json({ ...updated, _resetToDraft: shouldResetApproval });
    } else {
      res.status(500).json({ error: 'Failed to update rule' });
    }
  } catch (error) {
    console.error('Error updating rule:', error);
    res.status(500).json({ error: 'Failed to update rule', details: (error as Error).message });
  }
});

// Enable/disable rule
router.patch('/:id/toggle', (req, res) => {
  try {
    const { enabled, updated_by } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Disable other rules for same customer if enabling this one
    if (enabled === true) {
      if (rule.approval_status !== 'approved') {
        return res.status(400).json({
          error: 'Rule must be approved before it can be enabled',
          current_status: rule.approval_status
        });
      }

      const other = CustomerRuleModel.getByCustomer(rule.customer_id)
        .filter(r => r.id !== rule.id && r.enabled);

      for (const otherRule of other) {
        CustomerRuleModel.update(otherRule.id, { enabled: false, updated_by: updated_by || 'admin' });
      }
    }

    const updated = CustomerRuleModel.update(req.params.id, { enabled, updated_by: updated_by || 'admin' });
    res.json(updated);
  } catch (error) {
    console.error('Error toggling rule:', error);
    res.status(500).json({ error: 'Failed to toggle rule', details: (error as Error).message });
  }
});

// Test rule with sample data
router.post('/:id/test', async (req, res) => {
  try {
    const { testData, context } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Execute rule — bypass the enabled guard so draft rules can be tested
    const evaluationContext: RuleEvaluationContext = {
      transaction: testData.transaction,
      lineItems: testData.lineItems,
      customData: context
    };

    const result = await RuleEngine.evaluateRule({ ...rule, enabled: true }, evaluationContext);

    // Log test run
    db.prepare(`
      INSERT INTO rule_test_runs (rule_id, test_data, result, passed)
      VALUES (?, ?, ?, ?)
    `).run(
      req.params.id,
      JSON.stringify(testData),
      JSON.stringify(result),
      result.success ? 1 : 0
    );

    res.json(result);
  } catch (error) {
    console.error('Error testing rule:', error);
    res.status(500).json({ error: 'Failed to test rule', details: (error as Error).message });
  }
});

// Mark rule as tested
router.patch('/:id/mark-tested', (req, res) => {
  try {
    const { tested_by } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const updated = CustomerRuleModel.markTested(req.params.id, tested_by || 'admin');
    res.json(updated);
  } catch (error) {
    console.error('Error marking rule as tested:', error);
    res.status(500).json({ error: 'Failed to mark rule as tested', details: (error as Error).message });
  }
});

// Mark rule as approved (unlock for enabling)
router.patch('/:id/approve', (req, res) => {
  try {
    const { approved_by } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    if (rule.approval_status !== 'tested') {
      return res.status(400).json({ 
        error: 'Rule must be marked as tested before approval',
        current_status: rule.approval_status
      });
    }

    const updated = CustomerRuleModel.markApproved(req.params.id, approved_by || 'admin');
    res.json(updated);
  } catch (error) {
    console.error('Error approving rule:', error);
    res.status(500).json({ error: 'Failed to approve rule', details: (error as Error).message });
  }
});

// Revert rule to draft (for edits)
router.patch('/:id/revert-to-draft', (req, res) => {
  try {
    const { reverted_by } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Cannot revert if enabled
    if (rule.enabled) {
      return res.status(400).json({ 
        error: 'Cannot revert enabled rule to draft. Disable it first.'
      });
    }

    const updated = CustomerRuleModel.revertToDraft(req.params.id, reverted_by || 'admin');
    res.json(updated);
  } catch (error) {
    console.error('Error reverting rule:', error);
    res.status(500).json({ error: 'Failed to revert rule', details: (error as Error).message });
  }
});

const VALID_STEP_TYPES = new Set([
  'field_extraction', 'field_transform', 'match_transaction',
  'fuzzy_match', 'filter', 'aggregate', 'conditional'
]);

function validateAssistantSteps(steps: any[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const p = `Step ${i + 1}`;
    if (!s.id || typeof s.id !== 'string') errors.push(`${p}: missing id`);
    if (!s.type || !VALID_STEP_TYPES.has(s.type)) errors.push(`${p}: unknown type "${s.type}"`);
    if (!s.config || typeof s.config !== 'object') { errors.push(`${p}: missing config`); continue; }
    if (s.type === 'field_extraction') {
      if (!s.config.fieldName) errors.push(`${p}: field_extraction requires fieldName`);
      if (!s.config.outputKey) errors.push(`${p}: field_extraction requires outputKey`);
    } else if (s.type === 'field_transform') {
      if (!s.config.sourceKey) errors.push(`${p}: field_transform requires sourceKey`);
      if (!s.config.targetKey) errors.push(`${p}: field_transform requires targetKey`);
      if (!s.config.operation) errors.push(`${p}: field_transform requires operation`);
    } else if (s.type === 'match_transaction' || s.type === 'fuzzy_match') {
      if (!Array.isArray(s.config.matchFields) || s.config.matchFields.length === 0)
        errors.push(`${p}: ${s.type} requires non-empty matchFields array`);
    } else if (s.type === 'filter') {
      if (!s.config.field) errors.push(`${p}: filter requires field`);
      if (!s.config.operator) errors.push(`${p}: filter requires operator`);
    } else if (s.type === 'aggregate') {
      if (!s.config.sourceKey) errors.push(`${p}: aggregate requires sourceKey`);
      if (!s.config.outputKey) errors.push(`${p}: aggregate requires outputKey`);
      if (!s.config.operation) errors.push(`${p}: aggregate requires operation`);
    }
  }
  return errors;
}

// Rule Assistant: suggest rule steps from a natural-language description
router.post('/assistant/suggest', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
  }

  const { description, customer_id, sample_transactions } = req.body;
  if (!description || typeof description !== 'string' || description.trim().length < 5) {
    return res.status(400).json({ error: 'description is required (min 5 chars)' });
  }

  const SYSTEM_PROMPT = `You are a rule configuration assistant for an invoice-processing system.

The system maps warehouse transactions to pricelist line items. A "customer rule" is a list of steps that run per-transaction to help find the correct line item.

Available step types and their config schemas:

field_extraction  – extracts a transaction field into a named key
  { fieldName: string, outputKey: string, transformType: 'none'|'uppercase'|'lowercase'|'trim'|'parse_date' }

field_transform  – transforms a previously extracted key
  { sourceKey: string, targetKey: string, operation: 'uppercase'|'lowercase'|'trim'|'replace'|'substring', pattern?: string, replacement?: string, start?: number, length?: number }

match_transaction  – exact match on selected fields against pricelist line items
  { matchFields: Array<'segment'|'clause'|'category'|'unitOfMeasure'|'remark'>, conflictResolution: 'first_match'|'error' }

fuzzy_match  – scored partial match on selected fields
  { matchFields: Array<'segment'|'clause'|'category'|'unitOfMeasure'|'remark'>, threshold: number (0-1) }

filter  – gate on a field value; sets passFilter in context
  { field: string, operator: 'equals'|'contains'|'gt'|'lt'|'gte'|'lte', value: string|number }

conditional  – set a key to different values based on a condition
  { condition: 'fieldName:expectedValue', ifTrueKey: string, ifTrueValue: any, ifFalseKey: string, ifFalseValue: any }

Transaction fields available: id, date, segment, movementType, category, unitOfMeasure, description, quantity, orderNumber.
Pricelist line item fields: segment, clause, category, unitOfMeasure, remark, rate, row.

Return ONLY a JSON object in this exact format — no prose, no markdown fences:
{
  "steps": [ { "id": "step1", "type": "<type>", "enabled": true, "config": { ... } } ],
  "explanation": "<one sentence describing what the rule does>"
}`;

  const userContent = [
    `Customer: ${customer_id || 'unknown'}`,
    `Description: ${description.trim()}`,
    sample_transactions?.length
      ? `Sample transactions:\n${JSON.stringify(sample_transactions.slice(0, 3), null, 2)}`
      : null
  ].filter(Boolean).join('\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[RuleAssistant] Anthropic API error:', err);
      return res.status(502).json({ error: 'Anthropic API request failed', details: err });
    }

    const data: any = await response.json();
    const raw = data?.content?.[0]?.text ?? '';

    let parsed: { steps: any[]; explanation: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'Model returned non-JSON output', raw });
    }

    if (!Array.isArray(parsed.steps)) {
      return res.status(502).json({ error: 'Model output missing steps array', raw });
    }

    const stepErrors = validateAssistantSteps(parsed.steps);
    if (stepErrors.length > 0) {
      return res.status(502).json({ error: 'Model returned invalid steps', details: stepErrors, raw });
    }

    // Ensure every step has enabled: true so it is usable out of the box
    parsed.steps = parsed.steps.map((s: any) => ({ ...s, enabled: s.enabled !== false }));

    res.json(parsed);
  } catch (error) {
    console.error('[RuleAssistant] Error:', error);
    res.status(500).json({ error: 'Rule assistant failed', details: (error as Error).message });
  }
});

// Create a draft copy of any rule (used to safely iterate on active rules)
router.post('/:id/create-version', (req, res) => {
  try {
    const { created_by } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    const copy = CustomerRuleModel.createVersion(rule.customer_id, rule.id, created_by || 'admin');
    if (!copy) {
      return res.status(500).json({ error: 'Failed to create draft copy' });
    }
    res.status(201).json(copy);
  } catch (error) {
    console.error('Error creating rule version:', error);
    res.status(500).json({ error: 'Failed to create draft copy', details: (error as Error).message });
  }
});

// Delete rule
router.delete('/:id', (req, res) => {
  try {
    const { updated_by } = req.body;
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const deleted = CustomerRuleModel.delete(req.params.id);

    if (deleted) {
      db.prepare(`
        INSERT INTO rule_audit_log (rule_id, action, old_value, changed_by)
        VALUES (?, 'deleted', ?, ?)
      `).run(req.params.id, JSON.stringify(rule), updated_by || 'admin');

      res.status(204).send();
    } else {
      res.status(500).json({ error: 'Failed to delete rule' });
    }
  } catch (error) {
    console.error('Error deleting rule:', error);
    res.status(500).json({ error: 'Failed to delete rule', details: (error as Error).message });
  }
});

export default router;
