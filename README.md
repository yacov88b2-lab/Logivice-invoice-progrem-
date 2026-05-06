# Logivice Invoice Processor

A universal Excel processing application for logistics billing. Administrators upload pricelist templates, and users generate invoices by filling QTY fields from Tableau API data while preserving Rates.

## Features

- **Admin Interface**: Upload and manage pricelist templates per customer/warehouse
- **Template Analyzer**: Auto-detects Excel structure (columns, sheets, line items)
- **Tableau API Integration**: Fetches transaction data for billing periods
- **Smart Matching**: Maps API transactions to pricelist line items
- **QTY Filling**: Fills QTY fields and recalculates Totals (QTY x Rate)
- **Error Handling**: Shows unmatched transactions and ambiguous mappings
- **Audit Logging**: Tracks all operations with before/after values
- **Excel Export**: Preserves formatting and formulas in output

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Installation

Run commands from the project root (the folder that contains `package.json`).

```bash
npm install
```

If you get a PowerShell error like `npm.ps1 cannot be loaded because running scripts is disabled`:

- **Option 1 (recommended)**: run `npm install` from **Command Prompt (cmd)** instead of PowerShell.
- **Option 2**: in PowerShell run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Run Development Server

Run:

```bash
npm run dev
```

This starts both the frontend (Vite) and backend (Express) concurrently.

- Frontend: http://localhost:5173
- API: http://localhost:3001

### Build for Production

```bash
npm run build
```

## Usage

### Admin Workflow

1. Go to **Admin** tab
2. Click **Upload New Pricelist**
3. Enter:
   - Pricelist Name (format: `Customer name – Template YYYY`, e.g. `Afimilk – Template 2026`)
   - Customer Name (select from dropdown)
   - Warehouse Code (select from dropdown)
4. Upload Excel template file
5. System auto-analyzes structure

### User Workflow

1. Go to **User Dashboard** tab
2. Select pricelist from dropdown
3. Choose date range (billing period)
4. Click **Preview Mapping** to review matches
5. Review matched/unmatched transactions
6. Click **Generate Invoice**
7. Download updated Excel file

## Excel Template Structure

The app expects pricelist Excel files with:

| Column | Content |
|--------|---------|
| A | Segment (e.g., "Inbound", "Outbound") |
| B | Clause/Type (e.g., "Per Order", "Per Unit Scan") |
| C | Category (e.g., "General", "Domestic") |
| D | Unit of Measure (e.g., "order", "pallet", "box") |
| E | Remark/Description |
| F | Rate (pre-existing, must NOT be changed) |
| G | QTY (to be filled from API) |
| H | Total (auto-recalculated as QTY x Rate) |

Header row is auto-detected by looking for "Rate", "QTY", "Total" keywords.

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/pricelists` - List all pricelists
- `POST /api/pricelists` - Upload new pricelist
- `PUT /api/pricelists/:id` - Update pricelist
- `DELETE /api/pricelists/:id` - Delete pricelist
- `POST /api/generate/preview` - Preview mapping (dry run)
- `POST /api/generate/invoice` - Generate invoice
- `GET /api/generate/download/:auditId` - Download generated file
- `GET /api/tableau/options` - Customer/Warehouse option lists (used for admin dropdowns)

## Tableau API Configuration

Configure Tableau credentials via environment variables (see `.env.example`).

- Base URL: e.g. `https://dub01.online.tableau.com`
- Site: e.g. `logivice`
- Token name/value: stored in `.env` (do not commit tokens)

For development, mock transaction data may be used when Tableau is unavailable. In production, keep `ALLOW_MOCK_DATA=false` so invoice generation fails instead of using fake transactions.

## Afimilk Excel Generation Notes

Afimilk invoice generation uses an OpenXML patch approach (zip-level edits) to preserve the uploaded pricelist template sheets exactly.

- The Storage sheet is renamed to `Storage MM YYYY` and filled in columns B-E.
- Two sheets are ensured in the output file: `Management` and `Analyze`.
- Dependencies used by this path include `jszip` and `fast-xml-parser`.

## Admin Pricelist Management Notes

- Deleting a pricelist shows a confirmation prompt before the delete is performed.

## Architecture

```text
invoice-processor/
|-- server/
|   |-- db.ts                 # SQLite database setup
|   |-- models/               # Database models
|   |-- routes/               # API routes
|   `-- services/             # Business logic
|       |-- templateAnalyzer.ts
|       |-- dataMapper.ts
|       |-- qtyFiller.ts
|       `-- tableauAPI.ts
|-- src/
|   |-- components/
|   |   |-- admin/            # PricelistManager, PricelistList, PricelistUpload
|   |   `-- user/             # UserDashboard
|   |-- api.ts                # API client
|   |-- types.ts              # TypeScript types
|   `-- App.tsx               # Main app
`-- uploads/                  # Uploaded files storage
```

## Data Flow

1. Admin uploads pricelist Excel
2. System parses and extracts template structure (sheets, columns, line items)
3. User selects pricelist and date range
4. System calls Tableau API for transaction data
5. DataMapper matches transactions to line items by Segment+Clause+Category+UOM+Remark
6. Validator identifies unmatched/ambiguous items
7. User reviews and confirms
8. QTYFiller fills QTY column and recalculates Total = QTY x Rate
9. ExcelGenerator creates output preserving formatting
10. User downloads invoice
11. AuditLogger records operation

## Error Handling

The app handles these error cases:

- **Unmatched transactions**: No matching line item found
- **Ambiguous matches**: Multiple possible line items
- **Missing files**: Pricelist file not found
- **API errors**: Tableau API connection issues
- **Invalid data**: Negative quantities, missing dates

## License

MIT
