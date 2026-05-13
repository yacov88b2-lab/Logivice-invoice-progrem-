import express from 'express';
import { CustomerRuleModel } from '../../models/CustomerRule';
import { RuleEngine, type CustomerRuleDefinition, type RuleEvaluationContext } from '../../services/RuleEngine';
import { TableauAPIClient } from '../../services/tableauAPI';
import { parseTableauViewUrl } from '../../rules/_base';
import { validateAssistantSteps } from '../../services/stepValidator';
import db from '../../db';
import { requireAuth } from '../../middleware/auth';

const router = express.Router();
router.use(requireAuth);

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

    // Disable conflicting rules for same customer if enabling this one.
    // A "tableau-only" rule (all steps are tableau_table_copy) can coexist with a
    // matching/transformation rule; they serve different purposes and don't conflict.
    // Only disable rules of the same class (matching vs matching, tableau-only vs tableau-only).
    if (enabled === true) {
      if (rule.approval_status !== 'approved') {
        return res.status(400).json({
          error: 'Rule must be approved before it can be enabled',
          current_status: rule.approval_status
        });
      }

      const enabledSteps = rule.steps.filter((s: any) => s.enabled !== false);
      const thisIsTableauOnly = enabledSteps.length > 0 &&
        enabledSteps.every((s: any) => s.type === 'tableau_table_copy');

      const other = CustomerRuleModel.getByCustomer(rule.customer_id)
        .filter(r => r.id !== rule.id && r.enabled);

      for (const otherRule of other) {
        const otherEnabledSteps = otherRule.steps.filter((s: any) => s.enabled !== false);
        const otherIsTableauOnly = otherEnabledSteps.length > 0 &&
          otherEnabledSteps.every((s: any) => s.type === 'tableau_table_copy');

        // Only disable rules of the same class to avoid removing a coexisting rule
        if (thisIsTableauOnly === otherIsTableauOnly) {
          CustomerRuleModel.update(otherRule.id, { enabled: false, updated_by: updated_by || 'admin' });
        }
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

    // tableau_table_copy steps are workbook-level — route to dedicated handler
    const tableauStep = rule.steps.find(s => s.enabled !== false && s.type === 'tableau_table_copy');
    if (tableauStep) {
      return handleTableauCopyTest(rule, tableauStep, req.params.id, res);
    }

    // Execute rule — bypass the enabled guard so draft rules can be tested
    const evaluationContext: RuleEvaluationContext = {
      transaction: testData.transaction,
      lineItems: testData.lineItems,
      customData: context
    };

    const result = await RuleEngine.evaluateRule({ ...rule, enabled: true }, evaluationContext);

    // Derive test status from result shape
    const hasMatchStep = result.data && ('matches' in result.data || 'unmatched' in result.data);
    const hasMatch = hasMatchStep && Array.isArray(result.data?.matches) && result.data.matches.length > 0;
    let testStatus: 'passed' | 'failed' | 'error';
    if (!result.success || (result.errors && result.errors.length > 0)) {
      testStatus = 'error';
    } else if (hasMatchStep) {
      testStatus = hasMatch ? 'passed' : 'failed';
    } else {
      testStatus = 'passed';
    }

    // Log test run
    db.prepare(`
      INSERT INTO rule_test_runs (rule_id, test_data, result, result_data, status, passed, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      JSON.stringify(testData),
      JSON.stringify(result),
      JSON.stringify(result.data ?? null),
      testStatus,
      testStatus === 'passed' ? 1 : 0,
      'system'
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


// Validate a Tableau view URL: structural check + best-effort Tableau API verification.
router.post('/validate-tableau-url', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ valid: false, error: 'url is required' });
  }

  const parsed = parseTableauViewUrl(url);
  if (!parsed) {
    return res.json({
      valid: false,
      error: `URL did not match expected format. Received: "${url}". Expected: https://dub01.online.tableau.com/#/site/logivice/views/WorkbookName/ViewName (or /t/logivice/views/ format)`
    });
  }

  // Best-effort: try to confirm via Tableau API
  try {
    const client = new TableauAPIClient();
    const viewData = await client.findViewByName(parsed.workbook, parsed.view);
    if (!viewData) {
      return res.json({
        valid: true, urlParsed: true, viewFound: false,
        workbook: parsed.workbook, view: parsed.view,
        warning: 'URL structure is valid but the view could not be found via Tableau API. Check workbook/view names or credentials.'
      });
    }
    const sampleRows = viewData.rows.slice(0, 5).map(row =>
      viewData.columns.map(c => String(row[c] ?? ''))
    );
    return res.json({
      valid: true, viewFound: true,
      workbook: parsed.workbook, view: parsed.view,
      columns: viewData.columns, sampleRows, rowCount: viewData.rows.length
    });
  } catch (err) {
    return res.json({
      valid: true, urlParsed: true, viewFound: null,
      workbook: parsed.workbook, view: parsed.view,
      warning: 'URL structure is valid. Tableau API check skipped: ' + (err as Error).message
    });
  }
});

// Helper: run rule test for a tableau_table_copy step (not per-transaction).
async function handleTableauCopyTest(
  rule: CustomerRuleDefinition,
  step: any,
  ruleId: string,
  res: any
) {
  const url: string = (step.config?.url ?? '').trim();
  const parsed = parseTableauViewUrl(url);

  if (!parsed) {
    const diagnostic = url
      ? `Received: "${url}". Must be https://dub01.online.tableau.com/#/site/logivice/views/WorkbookName/ViewName`
      : 'No URL configured on this step.';
    const result = {
      success: false,
      data: { tableau_copy: { valid: false, error: `Invalid Tableau URL — ${diagnostic}` } },
      errors: ['Invalid Tableau URL'],
      warnings: [],
      executedSteps: [step.id]
    };
    db.prepare(`INSERT INTO rule_test_runs (rule_id, test_data, result, result_data, status, passed, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(ruleId, '{}', JSON.stringify(result), JSON.stringify(result.data), 'failed', 0, 'system');
    return res.json(result);
  }

  let viewData: Awaited<ReturnType<TableauAPIClient['findViewByName']>>;
  try {
    const client = new TableauAPIClient();
    viewData = await client.findViewByName(parsed.workbook, parsed.view);
  } catch {
    viewData = null;
  }

  const found = viewData !== null;
  const stepMode: string = step.config?.mode || 'raw_sheet';
  const data = found && viewData ? {
    tableau_copy: {
      valid: true, viewFound: true,
      workbook: parsed.workbook, view: parsed.view,
      columns: viewData.columns,
      sampleRows: viewData.rows.slice(0, 5).map(row => viewData!.columns.map(c => String(row[c] ?? ''))),
      totalRows: viewData.rows.length,
      targetSheet: step.config.targetSheet || parsed.view,
      mode: stepMode,
      startCell: stepMode === 'target_range' ? (step.config.startCell || null) : undefined,
      includeHeaders: step.config.includeHeaders !== false,
    }
  } : {
    tableau_copy: {
      valid: true, urlParsed: true, viewFound: false,
      workbook: parsed.workbook, view: parsed.view,
      warning: 'URL structure is valid but view could not be fetched. Check Tableau credentials or workbook/view name.'
    }
  };

  const testStatus = found ? 'passed' : 'failed';
  const result = { success: found, data, errors: found ? [] : ['View not found in Tableau'], warnings: [], executedSteps: [step.id] };
  db.prepare(`INSERT INTO rule_test_runs (rule_id, test_data, result, result_data, status, passed, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(ruleId, JSON.stringify({ tableau_copy: true, url }), JSON.stringify(result), JSON.stringify(data), testStatus, found ? 1 : 0, 'system');

  return res.json(result);
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
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[RuleAssistant] Anthropic API error:', errText);
      let friendlyMessage = 'Anthropic API request failed';
      try {
        const errJson = JSON.parse(errText);
        const msg: string = errJson?.error?.message ?? '';
        if (msg.toLowerCase().includes('credit')) {
          friendlyMessage = 'The AI feature is unavailable — Anthropic account credits are exhausted. Please top up at console.anthropic.com.';
        } else if (msg) {
          friendlyMessage = `Anthropic API error: ${msg}`;
        }
      } catch { /* ignore parse error */ }
      return res.status(502).json({ error: friendlyMessage });
    }

    const data: any = await response.json();
    const raw = data?.content?.[0]?.text ?? '';

    // Strip markdown code fences if the model wrapped its output
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    let parsed: { steps: any[]; explanation: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Last resort: extract the outermost JSON object
      const match = cleaned.match(/\{[\s\S]*\}/);
      try {
        parsed = match ? JSON.parse(match[0]) : (() => { throw new Error(); })();
      } catch {
        return res.status(502).json({ error: 'Model returned non-JSON output', raw });
      }
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
    const rule = CustomerRuleModel.getById(req.params.id);

    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    // Manually remove children first — the tables were created before CASCADE was added
    // so the live FK is NO ACTION, not CASCADE.
    db.prepare('DELETE FROM rule_test_runs WHERE rule_id = ?').run(req.params.id);
    db.prepare('DELETE FROM rule_audit_log WHERE rule_id = ?').run(req.params.id);

    const deleted = CustomerRuleModel.delete(req.params.id);

    if (deleted) {
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
