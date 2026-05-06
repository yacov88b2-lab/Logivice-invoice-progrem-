# Rule Engine Architecture Guide

## Overview

The Logivice Rule Engine provides a flexible, database-driven system for customer-specific invoice processing rules. Instead of hardcoding business logic per customer in TypeScript, rules are now defined as JSON configurations stored in SQLite and evaluated at runtime.

**Key Goals:**
- ✅ Support 20+ customers with unique billing rules
- ✅ Eliminate code deployments for rule changes
- ✅ Provide full audit trail of rule modifications
- ✅ Enable versioning and gradual rollout
- ✅ Support complex matching, transformation, and aggregation workflows

---

## Architecture Components

### 1. Rule Engine Service (`server/services/RuleEngine.ts`)

**Purpose:** Core evaluation engine that executes rules step-by-step against transaction data.

**Key Classes:**
- `RuleEngine`: Main orchestrator
  - `evaluateRule(rule, context)`: Execute full rule, return results
  - `executeStep(step, context)`: Execute single step, return partial result
  - Step executors for each of 7 step types

**Supported Step Types:**

| Step Type | Purpose | Example |
|-----------|---------|---------|
| `field_extraction` | Extract field from transaction, apply transform | Extract "segment" field, uppercase it |
| `field_transform` | Apply operation to previous result | Substring, replace, format |
| `match_transaction` | Match transaction to line item by exact fields | Find matching line item by segment+clause+category |
| `fuzzy_match` | Scoring-based match with threshold | Match descriptions with 70% similarity |
| `filter` | Include/exclude based on condition | Only process if amount > 100 |
| `aggregate` | Sum, count, deduplicate values | Count distinct orders, sum quantities |
| `conditional` | If-then branching logic | If segment=Inbound then apply inbound rules |

**Data Flow:**
```
Transaction → Step 1 → Step 2 → Step 3 → ... → Final Result
   context      (filter)  (match)  (transform)      output
```

### 2. Data Model (`server/models/CustomerRule.ts`)

**Purpose:** CRUD and versioning layer for database persistence.

**Key Methods:**
- `create(rule)`: Insert new rule, generate ID, return saved object
- `getById(id)`: Fetch single rule by ID
- `getByCustomer(customerId)`: Get all versions of customer's rules
- `getActiveByCustomer(customerId)`: Get currently enabled rule (max 1 per customer)
- `update(id, updates)`: Partial update with audit logging
- `delete(id)`: Remove rule with audit entry
- `createVersion(customerId, basedOnId)`: Create new version from existing

**Audit Integration:**
- Every change (create, update, enable, disable, delete) logged to `rule_audit_log` table
- Tracks who made change, what changed, when it happened
- Enables rollback and compliance review

### 3. Database Schema (`server/db.ts`)

**Tables:**

#### `customer_rules` (Main rule storage)
```sql
CREATE TABLE customer_rules (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER DEFAULT 1,
  enabled BOOLEAN DEFAULT 0,
  rule_type TEXT CHECK(rule_type IN ('matching', 'transformation', 'aggregation')),
  steps JSON NOT NULL,                -- Array of RuleStep objects
  created_at DATETIME,
  created_by TEXT,
  updated_at DATETIME,
  updated_by TEXT,
  UNIQUE(customer_id, version),       -- One version per customer
  CHECK(version > 0)
);
INDEX idx_customer_rules_customer_id ON customer_rules(customer_id);
INDEX idx_customer_rules_enabled ON customer_rules(enabled);
```

#### `rule_test_runs` (Test execution log)
```sql
CREATE TABLE rule_test_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT,
  test_data JSON,                     -- Input transaction + line items
  result_data JSON,                   -- RuleEvaluationResult
  status TEXT,                        -- 'passed', 'failed', 'error'
  created_at DATETIME,
  created_by TEXT,
  FOREIGN KEY(rule_id) REFERENCES customer_rules(id)
);
```

#### `rule_audit_log` (Change history)
```sql
CREATE TABLE rule_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT,
  action TEXT,                        -- 'created', 'updated', 'enabled', 'disabled', 'deleted'
  old_value JSON,                     -- Previous state
  new_value JSON,                     -- Current state
  changed_by TEXT,
  created_at DATETIME,
  FOREIGN KEY(rule_id) REFERENCES customer_rules(id)
);
```

### 4. REST API (`server/routes/api/rules.ts`)

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/rules` | List all rules (optional filter: ?customer_id=X&enabled=true) |
| `GET` | `/api/rules/:id` | Get single rule by ID |
| `GET` | `/api/rules/customer/:customer_id/active` | Get active rule for customer |
| `POST` | `/api/rules` | Create new rule |
| `PUT` | `/api/rules/:id` | Update rule (name, description, steps, etc.) |
| `PATCH` | `/api/rules/:id/toggle` | Enable/disable rule (disables others for same customer) |
| `POST` | `/api/rules/:id/test` | Execute rule against test data, log results |
| `DELETE` | `/api/rules/:id` | Delete rule with audit log |

**Request/Response Examples:**

```bash
# Create rule
POST /api/rules
{
  "customer_id": "Afimilk New Zealand",
  "name": "Storage Processing",
  "description": "Extract storage period and patch sheets",
  "ruleType": "transformation",
  "steps": [
    {
      "id": "extract_storage",
      "type": "field_extraction",
      "enabled": true,
      "config": {
        "fieldName": "storage_view_data",
        "outputKey": "storageData",
        "transformType": "none"
      }
    }
  ]
}

# Response: 201 Created
{
  "id": "rule_1704067200000",
  "customer_id": "Afimilk New Zealand",
  "version": 1,
  "enabled": false,
  "steps": [...],
  "created_at": "2024-01-01T12:00:00Z"
}
```

```bash
# Test rule
POST /api/rules/rule_1704067200000/test
{
  "testData": {
    "transaction": { "id": "txn_001", "segment": "Inbound", ... },
    "lineItems": [{ "id": "li_001", ... }]
  }
}

# Response: 200 OK
{
  "success": true,
  "data": { "extractedSegment": "INBOUND", ... },
  "executedSteps": 1,
  "errors": [],
  "warnings": []
}
```

### 5. UI Components (`src/components/admin/`)

#### RuleBuilder.tsx
React component for creating/editing rules.

**Features:**
- Rule metadata form (name, description, type)
- Step list with add/remove functionality
- Step-specific configuration UI (7 configurators, one per step type)
- Save to API with error handling
- Tailwind CSS styling

**Usage:**
```tsx
<RuleBuilder 
  customerId="Afimilk New Zealand"
  onSave={(rule) => console.log('Saved:', rule)}
  existingRule={optionalRuleToEdit}
/>
```

#### RuleTest.tsx
React component for testing rules before deployment.

**Features:**
- JSON test data input (textarea with syntax highlighting)
- Execute rule against test data via API
- Display results with success/error highlighting
- Show execution errors and warnings

**Usage:**
```tsx
<RuleTest rule={customerRule} />
```

---

## Rule Definition Guide

### Basic Structure

```typescript
interface CustomerRuleDefinition {
  id?: string;                    // Generated on creation
  customer_id: string;            // Required: which customer
  name: string;                   // Rule name
  description?: string;           // Optional documentation
  version: number;                // Version number (1, 2, 3...)
  enabled: boolean;               // Currently active?
  ruleType: 'matching' | 'transformation' | 'aggregation';
  steps: RuleStep[];              // Array of execution steps
  created_at?: string;            // Auto-set
  created_by?: string;            // Audit info
  updated_at?: string;
  updated_by?: string;
}

interface RuleStep {
  id: string;                     // Unique within rule
  type: string;                   // One of 7 step types
  enabled: boolean;               // Can disable individual steps
  config: Record<string, any>;    // Step-specific configuration
  metadata?: Record<string, any>; // Optional documentation
}
```

### Step Type Specifications

#### 1. field_extraction
Extract and transform transaction fields.

```json
{
  "type": "field_extraction",
  "config": {
    "fieldName": "segment",                    // Case-insensitive
    "outputKey": "extracted_segment",
    "transformType": "uppercase|lowercase|trim|parse_date|none"
  }
}
```

#### 2. field_transform
Apply operations to previous result.

```json
{
  "type": "field_transform",
  "config": {
    "sourceKey": "extracted_segment",         // From previousResults
    "operation": "uppercase|lowercase|trim|replace|substring|format",
    "targetKey": "transformed_value",
    "search": "-",                            // For replace
    "replacement": "_",
    "start": 0,                               // For substring
    "length": 3
  }
}
```

#### 3. match_transaction
Match transaction to line item by exact field values.

```json
{
  "type": "match_transaction",
  "config": {
    "matchFields": ["segment", "clause", "category"],  // Match on all these
    "conflictResolution": "first_match|ambiguous"
  }
}
```
**Output:** `data.matchedLineItem` (LineItem or undefined)

#### 4. fuzzy_match
Score-based matching with similarity threshold.

```json
{
  "type": "fuzzy_match",
  "config": {
    "matchFields": ["description"],
    "threshold": 0.7,                        // 0-1 scale
    "weights": {
      "description": 0.8,
      "category": 0.2
    }
  }
}
```
**Output:** `data.matchScore`, `data.matchedLineItem`

#### 5. filter
Include/exclude based on condition.

```json
{
  "type": "filter",
  "config": {
    "field": "amount",
    "operator": "equals|contains|gt|lt|gte|lte|in",
    "value": 100
  }
}
```
**Output:** `data.passFilter` (boolean)

#### 6. aggregate
Sum, count, or deduplicate values.

```json
{
  "type": "aggregate",
  "config": {
    "operation": "sum|count|distinct|avg|min|max",
    "sourceKey": "values_array",
    "field": "fieldName",                   // If aggregating on specific field
    "outputKey": "aggregated_result"
  }
}
```

#### 7. conditional
If-then branching.

```json
{
  "type": "conditional",
  "config": {
    "condition": "field:value|field1=field2",
    "ifTrueKey": "action",
    "ifTrueValue": "handle_inbound",
    "ifFalseKey": "action",
    "ifFalseValue": "skip"
  }
}
```

---

## Migration Scripts

### Moving Existing Rules to Database

#### Afimilk Rule (`server/migrations/createAfimilkRule.ts`)

Converts the existing Afimilk hardcoded logic:
- Extracts storage billing period from Tableau data
- Deduplicates storage entries
- Patches Excel sheets (OpenXML manipulation)
- Renames sheets by period

**Step Breakdown:**
1. Extract inbound/storage/outbound views
2. Parse storage dates and group by (date, week, warehouse)
3. Build Excel patches with data
4. Rename sheets to match period
5. Generate filename

#### Sensos Rule (`server/migrations/createSensosRule.ts`)

Converts Sensos aggregation logic:
- Calculates 8 synthetic quantities
- Maps to line items by segment+clause+category
- Applies storage SqM billing logic (per-area vs. minimum)
- Excludes certain users (e.g., Lilach Almasi)

**Synthetic Quantities:**
1. `__sensos_inbound_orders` - Distinct inbound refs
2. `__sensos_inbound_boxes` - Inbound billable scans
3. `__sensos_outbound_dom_orders` - Domestic outbound refs
4. `__sensos_outbound_int_orders` - International outbound refs
5. `__sensos_outbound_boxes` - Outbound billable scans
6. `__sensos_storage_total_sqm` - max_pallets × 1.5
7. `__sensos_exw_count` - EXW service orders
8. `__sensos_management_manual_orders` - Manual orders (excluding Lilach)

#### Running Migrations

```bash
# Load Afimilk and Sensos rules into database
ts-node server/migrations/runMigrations.ts

# Output:
# [Migrations] Creating Afimilk rule definition...
# [Migrations] ✓ Created Afimilk rule: rule_afimilk_default
# [Migrations] Creating Sensos rule definition...
# [Migrations] ✓ Created Sensos rule: rule_sensos_default
# [Migrations] ✓ All migrations completed successfully
# [Migrations] Note: Rules are currently DISABLED. Enable them via API or UI when ready.
```

---

## Testing Guide

### Unit Tests (`server/tests/RuleEngine.test.ts`)

Tests individual step executors and basic engine logic.

```bash
npm run test -- RuleEngine.test.ts
```

**Coverage:**
- Field extraction with all transforms
- Field transformation operations
- Exact matching logic
- Fuzzy matching with scoring
- Filter conditions (all operators)
- Aggregation operations
- Conditional branching
- Error handling

### Integration Tests (`server/tests/RuleEngineIntegration.test.ts`)

Tests full pipeline: database persistence, execution, audit logging.

```bash
npm run test -- RuleEngineIntegration.test.ts
```

**Coverage:**
- Create rule → load from DB → execute → log test results
- Rule versioning and activation
- Multi-customer isolation
- Audit trail generation
- Error recovery

### Manual Testing via UI

1. Navigate to `/admin/rules`
2. Click "Create Rule"
3. Fill in rule details
4. Add steps using "Add Step" buttons
5. Configure each step
6. Save rule
7. Click "Test" tab
8. Paste sample JSON test data
9. Click "Run Test"
10. Verify results

---

## Integration with DataMapper

### Current State
Rules hardcoded in `server/services/dataMapper.ts`:
- Afimilk → `rules/afimilk.ts`
- Sensos → `rules/sensos.ts`
- Default → `rules/_base.ts`

### Planned Integration

**Step 1: Add Feature Flag**
```typescript
const USE_DB_RULES = process.env.USE_DB_RULES === 'true';
```

**Step 2: Load Rules at Start**
```typescript
async function initializeRules() {
  const rules = await CustomerRuleModel.getActiveRules();
  rulesCache.set(rules);
}
```

**Step 3: Update mapTransactions Logic**
```typescript
async function mapTransactions(transactions, customerId) {
  if (USE_DB_RULES) {
    const rule = await CustomerRuleModel.getActiveByCustomer(customerId);
    if (rule) {
      return await engine.evaluateRule(rule, context);
    }
  }
  
  // Fallback to hardcoded rules
  return applyLegacyRules(transactions, customerId);
}
```

**Step 4: Zero-Downtime Migration**
- Deploy with `USE_DB_RULES=false` (uses old rules)
- Load rules into database
- Run side-by-side A/B testing
- Set `USE_DB_RULES=true` when confident
- Eventually remove legacy code

---

## Best Practices

### Rule Design
1. **Single Responsibility:** Each rule handles one customer/workflow
2. **Step Ordering:** Extract → Transform → Filter → Match → Aggregate
3. **Versioning:** Always bump version when making changes
4. **Testing:** Test rule before enabling in production
5. **Documentation:** Use `description` and `metadata` fields

### Performance
1. **Indexing:** Database has indexes on `customer_id` and `enabled`
2. **Caching:** Consider caching active rules in memory
3. **Step Optimization:** Disable unnecessary steps
4. **Batch Processing:** Evaluate multiple transactions in parallel

### Maintenance
1. **Audit Trail:** Review `rule_audit_log` regularly
2. **Version Control:** Keep migration scripts in Git
3. **Backup:** SQLite database backed up daily
4. **Monitoring:** Alert on rule execution failures

---

## Troubleshooting

### Rule Not Executing
1. Check if rule is enabled: `enabled = 1`
2. Verify customer_id matches transaction
3. Check rule_test_runs table for error messages
4. Review rule_audit_log for recent changes

### Wrong Results
1. Run rule through RuleTest UI with sample data
2. Check field names (case-insensitive, but must exist)
3. Verify step order and dependencies
4. Check operator logic (> vs >=, etc.)

### Performance Issues
1. Reduce number of steps if possible
2. Filter early (filter before match)
3. Consider caching results in previousResults
4. Profile with timing metadata

### Database Issues
1. Run integrity check: `PRAGMA integrity_check;`
2. Verify WAL mode enabled: `PRAGMA journal_mode;`
3. Check indexes exist: `PRAGMA index_list(customer_rules);`
4. Vacuum database: `VACUUM;`

---

## Future Enhancements

### Phase 2 (Planned)
- [ ] Visual rule builder (drag-and-drop UI)
- [ ] Rule templates for common patterns
- [ ] Performance metrics and analytics
- [ ] Scheduled rule execution (cron-based)
- [ ] Webhook notifications on rule changes

### Phase 3 (Future)
- [ ] Machine learning for rule suggestions
- [ ] Real-time rule validation
- [ ] Multi-language support for rule documentation
- [ ] Export/import rules as packages

---

## Contact & Support

For questions about the Rule Engine:
1. Check this documentation
2. Review existing rules: Afimilk, Sensos
3. Run unit tests for examples
4. Contact engineering team

---

**Last Updated:** 2024-01-01
**Version:** 1.0.0
**Status:** Phase 1 Complete, Ready for Phase 2
