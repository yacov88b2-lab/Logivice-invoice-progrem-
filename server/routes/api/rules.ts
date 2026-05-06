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

    // Log action
    db.prepare(`
      INSERT INTO rule_audit_log (rule_id, action, new_value, changed_by)
      VALUES (?, 'created', ?, ?)
    `).run(rule.id, JSON.stringify(rule.steps), created_by || 'admin');

    res.status(201).json(rule);
  } catch (error) {
    console.error('Error creating rule:', error);
    res.status(500).json({ error: 'Failed to create rule', details: (error as Error).message });
  }
});

// Update rule
router.put('/:id', (req, res) => {
  try {
    const { name, description, version, enabled, steps, updated_by } = req.body;
    const ruleId = req.params.id;

    const oldRule = CustomerRuleModel.getById(ruleId);
    if (!oldRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const updated = CustomerRuleModel.update(ruleId, {
      name: name || oldRule.name,
      description: description !== undefined ? description : oldRule.description,
      version: version || oldRule.version,
      enabled: enabled !== undefined ? enabled : oldRule.enabled,
      steps: steps || oldRule.steps,
      updated_by: updated_by || 'admin'
    });

    if (updated) {
      // Log changes
      if (JSON.stringify(steps) !== JSON.stringify(oldRule.steps)) {
        db.prepare(`
          INSERT INTO rule_audit_log (rule_id, action, old_value, new_value, changed_by)
          VALUES (?, 'updated', ?, ?, ?)
        `).run(ruleId, JSON.stringify(oldRule.steps), JSON.stringify(steps), updated_by || 'admin');
      }

      res.json(updated);
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
      const other = CustomerRuleModel.getByCustomer(rule.customer_id)
        .filter(r => r.id !== rule.id && r.enabled);

      for (const otherRule of other) {
        CustomerRuleModel.update(otherRule.id, { enabled: false, updated_by: updated_by || 'admin' });
        db.prepare(`
          INSERT INTO rule_audit_log (rule_id, action, new_value, changed_by)
          VALUES (?, 'disabled', ?, ?)
        `).run(otherRule.id, 'false', updated_by || 'admin');
      }
    }

    const updated = CustomerRuleModel.update(req.params.id, { enabled, updated_by: updated_by || 'admin' });

    db.prepare(`
      INSERT INTO rule_audit_log (rule_id, action, new_value, changed_by)
      VALUES (?, ?, ?, ?)
    `).run(req.params.id, enabled ? 'enabled' : 'disabled', String(enabled), updated_by || 'admin');

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

    // Execute rule
    const evaluationContext: RuleEvaluationContext = {
      transaction: testData.transaction,
      lineItems: testData.lineItems,
      customData: context
    };

    const result = await RuleEngine.evaluateRule(rule, evaluationContext);

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
