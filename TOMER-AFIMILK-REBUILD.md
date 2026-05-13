# Afimilk NZ — Rule Engine Rebuild Spec

## Goal
Replace the hardcoded Afimilk logic in `server/rules/afimilk.ts` and
`server/routes/api/generate.ts` with a proper rule-engine rule that any
admin can configure without touching code.

## Current hardcoded flow (what you're replacing)

```
generate.ts
  └── if isAfimilkBilling → skip Excel extraction, use Tableau
  └── fillInvoice()
        └── detectCustomer() → 'afimilk'
              └── fillAfimilkPreserveTemplate()   ← afimilk.ts
                    ├── patch "Scans Inbound" sheet  (Tableau Inbound view)
                    ├── patch "Scans Outbound" sheet (Tableau Outbound view)
                    ├── patch "Storage" sheet        (Tableau Storage view, weekly totals)
                    ├── fill "Rates" sheet quantities
                    ├── rename Storage sheet → "Storage MM-YYYY"
                    └── rename Scans Inbound → "Scans Inbound MM-YYYY"
```

## What already works in the rule engine

| Step type           | What it does                                        | Usable for Afimilk? |
|---------------------|-----------------------------------------------------|---------------------|
| `tableau_table_copy`| Copies a Tableau view into an Excel sheet           | Partially — writes raw data but destroys template formatting |

## What needs to be built (new step types)

### 1. `tableau_template_patch`
Like `tableau_table_copy` but uses the OpenXML patch approach from
`afimilk.ts:patchScansInboundWorksheetXml / patchScansOutboundWorksheetXml`.

Config:
```json
{
  "tableauUrl": "https://dub01.online.tableau.com/#/site/logivice/views/...",
  "targetSheet": "Scans Inbound",
  "startCell": "B1",
  "includeHeaders": false,
  "dateColumn": "Inbound at",
  "dateOutputFormat": "DD/MM/YYYY"
}
```
Key requirement: **preserve all template formulas, styles, and merged cells** —
only overwrite the data cells, never the surrounding design.

---

### 2. `tableau_storage_patch`
Specialised version of the above for the Storage sheet.
Pulls Tableau "Storage" view, **aggregates rows into weekly totals**
(logic in `afimilk.ts:buildAfimilkStorageEntries` +
`buildAfimilkStorageWeeklyAllTotals`), then patches the template.

Config:
```json
{
  "tableauUrl": "https://dub01.online.tableau.com/#/site/logivice/views/.../Storage",
  "targetSheet": "Storage",
  "startCell": "A1"
}
```

---

### 3. `rename_sheet_by_period`
Renames a sheet using the billing period extracted from the data
(e.g. "Storage" → "Storage 04-2026").

Config:
```json
{
  "sourceSheet": "Storage",
  "pattern": "Storage MM-YYYY"
}
```
Period source: derived from the date range the user selected when
creating the invoice.

---

### 4. Date normalisation (built into steps 1 & 2)
The Tableau data for Afimilk contains dates in mixed formats:
- Excel serial number (e.g. `46112`)
- Unix timestamp in milliseconds (e.g. `1710892800000`)
- `DD/MM/YYYY` string
- Hebrew date string (ignore / pass through as-is)

All date columns must be normalised to `DD/MM/YYYY` before writing to
the template. This logic already exists in `afimilk.ts` — reuse it.

---

## Migration plan

1. Build and test the three new step types above (keep `afimilk.ts` in place)
2. Create a new CustomerRule for "Afimilk New Zealand" using only the new steps
3. Test end-to-end: generate a real invoice and compare against the current output
4. Once confirmed identical, remove the `isAfimilkBilling` branch in `generate.ts`
   and delete `server/rules/afimilk.ts`

## Files to eventually delete (after rebuild is verified)

- `server/rules/afimilk.ts`
- The `isAfimilkBilling` blocks in `server/routes/api/generate.ts`
  (lines 107–128, 612–642)
- The afimilk import in `server/rules/index.ts`

## Files already cleaned up

- `server/services/qtyFiller.ts` — deleted (was 100% dead code, all functions
  duplicated from afimilk.ts, nothing imported it)
