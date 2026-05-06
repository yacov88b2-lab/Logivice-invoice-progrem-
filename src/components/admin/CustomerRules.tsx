const ruleGroups = [
  {
    customer: 'Afimilk New Zealand',
    status: 'Code-backed',
    owner: 'server/rules/afimilk.ts',
    rules: [
      'Storage billing period is extracted from the inbound billing month.',
      'Generated invoice filename follows the customer billing period.',
      'Invoice quantities are written into the customer template.',
    ],
  },
  {
    customer: 'Sensos',
    status: 'Code-backed',
    owner: 'server/rules/sensos.ts',
    rules: [
      'Customer-specific quantity mapping is applied before Excel fill.',
      'Template sheets are handled through the Sensos invoice handler.',
      'Fallback fill uses the shared invoice engine.',
    ],
  },
  {
    customer: 'Default customers',
    status: 'Shared rule',
    owner: 'server/rules/_base.ts',
    rules: [
      'Transactions are matched to line items by segment, clause, category, and unit.',
      'Matched quantities are aggregated before the invoice is generated.',
      'Unmatched rows are reported for review before final download.',
    ],
  },
];

const futureControls = [
  'Customer aliases',
  'Warehouse defaults',
  'Minimum charge rules',
  'Rounding policy',
  'Excluded Tableau users',
  'Special line item mappings',
];

export function CustomerRules() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#58a967]">
            Rule Control
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">
            Customer Rules
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Current customer behavior is still code-backed. This screen gives the business a clear view of what exists now and the exact controls that should become editable in the app next.
          </p>
        </div>
        <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Editing is planned, not enabled yet.
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-3">
        {ruleGroups.map(group => (
          <article key={group.customer} className="rounded border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">{group.customer}</h3>
                <p className="mt-1 text-xs text-slate-500">{group.owner}</p>
              </div>
              <span className="rounded bg-[#e9f6ec] px-2.5 py-1 text-xs font-semibold text-[#28753a]">
                {group.status}
              </span>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-slate-700">
              {group.rules.map(rule => (
                <li key={rule} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#58bd69]" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="rounded border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-950">Next Editable Controls</h3>
          <p className="mt-1 text-sm text-slate-600">
            These are the safest first settings to move from code into the database.
          </p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {futureControls.map(control => (
            <button
              key={control}
              type="button"
              disabled
              className="flex min-h-16 items-center justify-between rounded border border-slate-200 bg-slate-50 px-4 text-left text-sm font-medium text-slate-600"
            >
              {control}
              <span className="rounded bg-white px-2 py-1 text-xs text-slate-500">Soon</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
