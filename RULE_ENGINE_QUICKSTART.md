# Rule Engine Quick Start Guide

## For Admins: Managing Customer Rules

### Access the Rules UI

Navigate to `/admin/rules` in your browser to access the rule management interface.

### Creating Your First Rule

#### 1. Rule Details
- **Name:** Give your rule a descriptive name (e.g., "Afimilk Storage Processing")
- **Description:** Explain what this rule does (optional but recommended)
- **Rule Type:** Choose from:
  - **Matching:** Finds the right line item for a transaction
  - **Transformation:** Changes data (e.g., patches Excel sheets)
  - **Aggregation:** Calculates synthetic quantities
- **Enabled:** Uncheck initially to test first

#### 2. Add Steps
Click "+ Add Step" buttons to build your rule. Add them in this order:

1. **Extract data** (field_extraction)
2. **Transform it** (field_transform) - if needed
3. **Filter** (filter) - if needed
4. **Find matching item** (match_transaction)
5. **Aggregate** (aggregate) - if needed
6. **Branch logic** (conditional) - if needed

#### 3. Save
Click "Save Rule" - your rule is now in the database but disabled.

---

## Configuring Each Step Type

### Step 1: Extract Field
Extract a value from the incoming transaction.

**Configuration:**
- **Field Name:** Which field to extract (e.g., `segment`, `amount`, `ref`)
- **Transform Type:**
  - `none` - Keep as-is
  - `uppercase` - Convert to UPPER
  - `lowercase` - Convert to lower
  - `trim` - Remove leading/trailing spaces
  - `parse_date` - Parse date in various formats

**Example:** Extract and uppercase the segment
```
Field Name: segment
Output Key: extracted_segment
Transform: uppercase
```

### Step 2: Transform Value
Apply an operation to a previously extracted value.

**Configuration:**
- **Source Key:** The output from previous step
- **Operation:** What to do
  - `uppercase` / `lowercase` / `trim`
  - `replace` - Find and replace text
  - `substring` - Extract part of string
- **Target Key:** Where to store result

**Example:** Replace hyphens with underscores
```
Source Key: extracted_ref
Operation: replace
Search: -
Replacement: _
Target Key: formatted_ref
```

### Step 3: Filter
Include or exclude this transaction based on a condition.

**Configuration:**
- **Field:** Which field to check
- **Operator:** 
  - `equals` - Exact match
  - `contains` - Text contains
  - `gt` / `lt` / `gte` / `lte` - Number comparisons
- **Value:** What to match

**Example:** Only process inbound orders
```
Field: segment
Operator: equals
Value: Inbound
```

### Step 4: Exact Match
Find the line item that matches this transaction.

**Configuration:**
- **Match Fields:** Which fields must match (comma-separated)
  - E.g., `segment,clause,category` means all three must match
- **Conflict Resolution:**
  - `first_match` - Use the first matching line item
  - `ambiguous` - Mark if multiple matches found

**Example:** Match on segment + category
```
Match Fields: segment,category
Conflict Resolution: first_match
```

### Step 5: Fuzzy Match
Find the closest matching line item using similarity scoring.

**Configuration:**
- **Match Fields:** Which fields to compare
- **Threshold:** How similar must it be (0-1 scale)
  - 0.7 = 70% similar
  - 0.9 = 90% similar (stricter)

**Example:** Match descriptions with 70% similarity
```
Match Fields: description
Threshold: 0.7
```

### Step 6: Aggregate
Calculate totals or counts.

**Configuration:**
- **Operation:**
  - `sum` - Add up values
  - `count` - Count how many
  - `distinct` - Count unique values
- **Source Key:** Array to aggregate
- **Output Key:** Where to store result

**Example:** Count distinct order references
```
Operation: distinct_count
Source Key: inbound_orders
Output Key: total_inbound_orders
```

### Step 7: Conditional
If-then logic for branching.

**Configuration:**
- **Condition:** What to check (e.g., `segment:Inbound`)
- **If True:** What to set
- **If False:** Alternative value

**Example:** Route based on segment
```
Condition: segment:Inbound
If True → action = "handle_inbound"
If False → action = "handle_outbound"
```

---

## Testing Your Rule

### Before Enabling (CRITICAL!)

1. Go to the **Test** tab
2. Paste sample data (JSON format):

```json
{
  "transaction": {
    "id": "txn_001",
    "segment": "Inbound",
    "amount": 150,
    "ref": "REF-12345"
  },
  "lineItems": [
    {
      "id": "li_001",
      "segment": "Inbound",
      "description": "Inbound handling",
      "quantity": 0,
      "unitPrice": 25
    }
  ]
}
```

3. Click "Run Test"
4. Review results:
   - **Green box** = Success ✓
   - **Red box** = Failed ✗
5. Check if output matches expectations

### Test Different Scenarios

Create test data for:
- Normal case (should match)
- Edge case (boundary condition)
- Failure case (should not match)

---

## Enabling Your Rule

### Step 1: Verify in Test Environment
- Test rule thoroughly with real data
- Check for unintended side effects
- Review audit log for any issues

### Step 2: Check for Conflicts
Only ONE rule can be enabled per customer. If you enable a new rule, any previous rule for that customer is automatically disabled.

**To enable:**
1. Go to rule list
2. Click the rule
3. Check "Enabled"
4. Save

### Step 3: Monitor
After enabling:
- Watch invoice generation logs
- Check for errors in rule_test_runs table
- Monitor customer feedback

---

## Common Rule Patterns

### Pattern 1: Simple Segment Matching
**Use Case:** Match transactions to line items by segment

**Steps:**
1. Extract segment (uppercase)
2. Match on segment

### Pattern 2: Fuzzy Description Matching
**Use Case:** Match by description similarity when exact match fails

**Steps:**
1. Extract description (lowercase, trim)
2. Fuzzy match on description (threshold 0.7)

### Pattern 3: Amount-Based Routing
**Use Case:** Process differently based on amount

**Steps:**
1. Extract amount
2. Filter (amount > 1000)
3. Conditional branching
4. Match based on selected condition

### Pattern 4: Multi-Field Matching
**Use Case:** Match on multiple fields for accuracy

**Steps:**
1. Extract segment
2. Extract category
3. Extract clause
4. Exact match on (segment, category, clause)

### Pattern 5: Date Parsing & Processing
**Use Case:** Extract dates from various formats

**Steps:**
1. Extract date_field (parse_date transform)
2. Transform (extract month/year if needed)
3. Use in downstream logic

---

## Troubleshooting

### "Rule is disabled"
- Click on the rule
- Check the "Enabled" checkbox
- Save
- Try again

### "No matching line item found"
- Review test data
- Check matching fields are spelled correctly
- Use less strict matching (fuzzy instead of exact)
- Try different fields

### "Test data format error"
- Ensure JSON is valid (use [jsonlint.com](https://jsonlint.com))
- Include required fields: `transaction`, `lineItems`
- Check for missing quotes or commas

### "Rule changes not taking effect"
- Rules are cached in memory
- Server restart needed to refresh (or wait for auto-reload)
- Check rule is enabled
- Verify customer_id matches transaction

### "Accidentally deleted rule"
- Check `rule_audit_log` table for deletion
- Restore from backup if needed
- Create rule again with same configuration

---

## Real-World Examples

### Example 1: Sensos Storage Billing

**Rule Name:** Sensos Quantity Aggregation

**Steps:**
1. **Extract:** Extract `inbound_orders` (distinct count)
   - Field: inbound_view_data
   - Transform: none
   
2. **Extract:** Extract `storage_data`
   - Field: storage_view_data
   - Transform: none
   
3. **Transform:** Calculate SqM (pallets × 1.5)
   - Source: storage_data
   - Operation: storage_sqm_calculation
   
4. **Conditional:** Determine minimum charge
   - Condition: sqm_cost < minimum
   - If true: charge_type = "minimum"
   - If false: charge_type = "per_area"

5. **Match:** Map to line items
   - Match fields: segment, clause

### Example 2: Afimilk Sheet Patching

**Rule Name:** Afimilk Storage Processing

**Steps:**
1. **Extract:** Extract inbound data
   - Field: inbound_view_data
   
2. **Extract:** Extract storage period
   - Field: storage_view_data
   - Transform: none
   
3. **Transform:** Parse dates
   - Source: storage_view_data
   - Operation: parse_date
   
4. **Aggregate:** Group by warehouse
   - Operation: group_by
   - Group fields: warehouse, date
   
5. **Transform:** Patch Excel sheets
   - Operation: excel_patch
   - Target: Inbound, Outbound, Storage sheets

---

## Best Practices

✅ **DO:**
- Test before enabling
- Name rules clearly
- Document with descriptions
- Keep steps simple
- Review audit log regularly
- Disable old rules (don't delete)
- Backup database before major changes

❌ **DON'T:**
- Enable multiple rules per customer
- Use vague field names
- Skip testing
- Delete rules (disable them instead)
- Make sudden changes in production
- Forget to document complex logic

---

## Support

### Finding Help
1. Check examples in rule list
2. Review this quick start
3. Read RULE_ENGINE_GUIDE.md
4. Contact engineering team

### Reporting Issues
When reporting a problem, include:
- Rule name and customer
- Test data that fails
- Expected vs. actual result
- Error message (if any)

---

**Last Updated:** 2024-01-01
**Version:** 1.0.0
