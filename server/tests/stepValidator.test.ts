import { describe, it, expect } from 'vitest';
import { validateAssistantSteps } from '../services/stepValidator';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_URL = 'https://dub01.online.tableau.com/#/site/logivice/views/MyWorkbook/MyView';

function makeStep(overrides: Record<string, any> = {}): any {
  return {
    id: 'step_1',
    type: 'tableau_table_copy',
    enabled: true,
    config: {
      url: VALID_URL,
      mode: 'raw_sheet',
      targetSheet: 'Inbound Data',
      includeHeaders: true,
    },
    ...overrides,
  };
}

// ── General step validation ───────────────────────────────────────────────────

describe('validateAssistantSteps — general', () => {
  it('returns no errors for empty steps array', () => {
    expect(validateAssistantSteps([])).toHaveLength(0);
  });

  it('errors on missing step id', () => {
    const errs = validateAssistantSteps([{ type: 'filter', config: { field: 'x', operator: 'equals' } }]);
    expect(errs.some(e => /missing id/i.test(e))).toBe(true);
  });

  it('errors on unknown step type', () => {
    const errs = validateAssistantSteps([{ id: 's1', type: 'magic_step', config: {} }]);
    expect(errs.some(e => /unknown type/i.test(e))).toBe(true);
  });

  it('errors on missing config object', () => {
    const errs = validateAssistantSteps([{ id: 's1', type: 'filter', config: null }]);
    expect(errs.some(e => /missing config/i.test(e))).toBe(true);
  });
});

// ── tableau_table_copy — valid configs ────────────────────────────────────────

describe('validateAssistantSteps — tableau_table_copy valid', () => {
  it('accepts a valid raw_sheet config', () => {
    expect(validateAssistantSteps([makeStep()])).toHaveLength(0);
  });

  it('accepts a valid target_range config', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: 'A10', includeHeaders: true } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });

  it('accepts target_range with multi-letter column ref', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Summary', startCell: 'BC5' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });

  it('accepts config without includeHeaders (optional)', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });
});

// ── tableau_table_copy — URL validation ───────────────────────────────────────

describe('validateAssistantSteps — tableau_table_copy URL', () => {
  it('errors when url is missing', () => {
    const step = makeStep({ config: { mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /requires url/i.test(e))).toBe(true);
  });

  it('errors when url is from wrong domain', () => {
    const step = makeStep({ config: { url: 'https://public.tableau.com/#/site/logivice/views/WB/V', mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /dub01\.online\.tableau\.com/i.test(e))).toBe(true);
  });

  it('errors when url is from wrong site', () => {
    const step = makeStep({ config: { url: 'https://dub01.online.tableau.com/#/site/other/views/WB/V', mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /dub01\.online\.tableau\.com/i.test(e))).toBe(true);
  });
});

// ── tableau_table_copy — mode validation ─────────────────────────────────────

describe('validateAssistantSteps — tableau_table_copy mode', () => {
  it('errors when mode is missing', () => {
    const step = makeStep({ config: { url: VALID_URL, targetSheet: 'Sheet1' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /mode must be/i.test(e))).toBe(true);
  });

  it('errors when mode is an unrecognised string', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'copy_sheet', targetSheet: 'Sheet1' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /mode must be/i.test(e))).toBe(true);
  });

  it('accepts "raw_sheet" mode', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });

  it('accepts "target_range" mode when startCell is valid', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Sheet1', startCell: 'A1' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });
});

// ── tableau_table_copy — targetSheet validation ───────────────────────────────

describe('validateAssistantSteps — tableau_table_copy targetSheet', () => {
  it('errors when targetSheet is missing (raw_sheet)', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /requires targetSheet/i.test(e))).toBe(true);
  });

  it('errors when targetSheet is missing (target_range)', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', startCell: 'A10' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /requires targetSheet/i.test(e))).toBe(true);
  });

  it('errors when targetSheet is an empty string', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: '   ' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /requires targetSheet/i.test(e))).toBe(true);
  });
});

// ── tableau_table_copy — target_range startCell validation ────────────────────

describe('validateAssistantSteps — tableau_table_copy target_range startCell', () => {
  it('errors when startCell is missing for target_range', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /startCell/i.test(e))).toBe(true);
  });

  it('errors when startCell is row-zero (A0)', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: 'A0' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /startCell/i.test(e))).toBe(true);
  });

  it('errors when startCell has no column letters', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: '10' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /startCell/i.test(e))).toBe(true);
  });

  it('errors when startCell has no row number', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: 'A' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /startCell/i.test(e))).toBe(true);
  });

  it('does NOT error on startCell for raw_sheet (not applicable)', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /startCell/i.test(e))).toBe(false);
  });

  it('accepts valid startCell A1', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: 'A1' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });

  it('accepts valid startCell B10', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: 'B10' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });

  it('accepts valid startCell AA5 (multi-letter column)', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total', startCell: 'AA5' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });
});

// ── tableau_table_copy — includeHeaders validation ────────────────────────────

describe('validateAssistantSteps — tableau_table_copy includeHeaders', () => {
  it('errors when includeHeaders is a string instead of boolean', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1', includeHeaders: 'true' } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /includeHeaders must be boolean/i.test(e))).toBe(true);
  });

  it('errors when includeHeaders is a number', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1', includeHeaders: 1 } });
    const errs = validateAssistantSteps([step]);
    expect(errs.some(e => /includeHeaders must be boolean/i.test(e))).toBe(true);
  });

  it('accepts includeHeaders: false', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1', includeHeaders: false } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });

  it('accepts omitted includeHeaders', () => {
    const step = makeStep({ config: { url: VALID_URL, mode: 'raw_sheet', targetSheet: 'Sheet1' } });
    expect(validateAssistantSteps([step])).toHaveLength(0);
  });
});

// ── Multi-step accumulation ───────────────────────────────────────────────────

describe('validateAssistantSteps — multi-step error accumulation', () => {
  it('reports errors from multiple steps independently', () => {
    const steps = [
      { id: 's1', type: 'tableau_table_copy', config: { mode: 'raw_sheet', targetSheet: 'Sheet1' } }, // missing url
      { id: 's2', type: 'tableau_table_copy', config: { url: VALID_URL, mode: 'target_range', targetSheet: 'Total' } }, // missing startCell
    ];
    const errs = validateAssistantSteps(steps);
    expect(errs.some(e => e.startsWith('Step 1') && /url/i.test(e))).toBe(true);
    expect(errs.some(e => e.startsWith('Step 2') && /startCell/i.test(e))).toBe(true);
  });
});
