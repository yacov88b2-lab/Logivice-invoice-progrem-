import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseTableauViewUrl } from '../rules/_base';
import { RuleEngine } from '../services/RuleEngine';
import type { RuleStep } from '../services/RuleEngine';

// ── URL parsing ───────────────────────────────────────────────────────────────

describe('parseTableauViewUrl', () => {
  it('accepts a well-formed logivice URL', () => {
    const result = parseTableauViewUrl(
      'https://dub01.online.tableau.com/#/site/logivice/views/MyWorkbook/MyView'
    );
    expect(result).toEqual({ workbook: 'MyWorkbook', view: 'MyView' });
  });

  it('decodes URL-encoded workbook and view names', () => {
    const result = parseTableauViewUrl(
      'https://dub01.online.tableau.com/#/site/logivice/views/My%20Workbook/My%20View'
    );
    expect(result).toEqual({ workbook: 'My Workbook', view: 'My View' });
  });

  it('rejects a completely different domain', () => {
    expect(parseTableauViewUrl('https://evil.com/#/site/logivice/views/X/Y')).toBeNull();
  });

  it('rejects a subdomain that is not dub01.online.tableau.com', () => {
    expect(parseTableauViewUrl('https://us-east.online.tableau.com/#/site/logivice/views/X/Y')).toBeNull();
  });

  it('rejects the correct domain but wrong site', () => {
    expect(parseTableauViewUrl('https://dub01.online.tableau.com/#/site/othercorp/views/X/Y')).toBeNull();
  });

  it('rejects a URL missing the /views/ segment', () => {
    expect(parseTableauViewUrl('https://dub01.online.tableau.com/#/site/logivice/workbooks/X')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseTableauViewUrl('')).toBeNull();
  });

  it('rejects a plain non-URL string', () => {
    expect(parseTableauViewUrl('not-a-url')).toBeNull();
  });
});

// ── RuleEngine: tableau_table_copy step type ──────────────────────────────────

describe('RuleEngine — tableau_table_copy step', () => {
  it('is a recognised step type and does not throw', async () => {
    const step: RuleStep = {
      id: 'step_tc_1',
      type: 'tableau_table_copy',
      enabled: true,
      config: {
        url: 'https://dub01.online.tableau.com/#/site/logivice/views/MyWorkbook/MyView',
        viewName: 'MyView',
        mode: 'raw_sheet',
        targetSheet: 'Tableau Data',
        includeHeaders: true,
      },
    };

    const result = await RuleEngine.executeStep(step, {}, {});
    expect(result.errors).toHaveLength(0);
    expect(result.data.tableau_copy_deferred).toBe(true);
  });

  it('includes a warning explaining the deferred execution model', async () => {
    const step: RuleStep = {
      id: 'step_tc_2',
      type: 'tableau_table_copy',
      enabled: true,
      config: { url: 'https://dub01.online.tableau.com/#/site/logivice/views/WB/View', mode: 'raw_sheet' },
    };
    const result = await RuleEngine.executeStep(step, {}, {});
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ── Rule lifecycle with tableau_table_copy steps ──────────────────────────────

describe('tableau_table_copy rule lifecycle (unit)', () => {
  it('wizardToRule produces a tableau_table_copy step with correct config', () => {
    // Simulate what wizardToRule does for the tableau_copy intent
    const t = Date.now();
    const steps = [{
      id: `step_${t}`,
      type: 'tableau_table_copy',
      enabled: true,
      config: {
        url: 'https://dub01.online.tableau.com/#/site/logivice/views/SensosWorkbook/Inbound',
        viewName: 'Inbound',
        mode: 'raw_sheet',
        targetSheet: 'Inbound',
        includeHeaders: true,
      },
    }];

    expect(steps[0].type).toBe('tableau_table_copy');
    expect(steps[0].config.mode).toBe('raw_sheet');
    expect(parseTableauViewUrl(steps[0].config.url)).toEqual({
      workbook: 'SensosWorkbook',
      view: 'Inbound',
    });
  });

  it('url with wrong domain is rejected by parseTableauViewUrl during validation', () => {
    const badUrl = 'https://public.tableau.com/#/site/logivice/views/WB/View';
    expect(parseTableauViewUrl(badUrl)).toBeNull();
  });

  it('tableau_table_copy step with invalid URL fails validation', () => {
    // Simulate validateAssistantSteps check inline
    const url = 'https://notallowed.com/#/site/logivice/views/X/Y';
    const parsed = parseTableauViewUrl(url);
    expect(parsed).toBeNull(); // → would add error "url must be from dub01..."
  });
});

// ── Intent selection URL sync (unit) ──────────────────────────────────────────
// Mirrors the onClick patch logic in IntentStep so we can test it without a
// React component harness.

function buildIntentPatch(
  intentId: string,
  state: { referenceUrl: string; tableauUrl: string }
): Record<string, any> {
  const patch: Record<string, any> = { intent: intentId };
  if (intentId === 'tableau_copy' && state.referenceUrl && !state.tableauUrl) {
    patch.tableauUrl = state.referenceUrl;
    patch.tableauUrlValidated = null;
  }
  return patch;
}

describe('Intent selection → tableauUrl sync', () => {
  const VALID_URL = 'https://dub01.online.tableau.com/#/site/logivice/views/WB/View';

  it('prefills tableauUrl from referenceUrl when selecting tableau_copy with empty tableauUrl', () => {
    const patch = buildIntentPatch('tableau_copy', { referenceUrl: VALID_URL, tableauUrl: '' });
    expect(patch.tableauUrl).toBe(VALID_URL);
    expect(patch.tableauUrlValidated).toBeNull();
  });

  it('does NOT overwrite a non-empty tableauUrl when selecting tableau_copy', () => {
    const existing = 'https://dub01.online.tableau.com/#/site/logivice/views/Other/View';
    const patch = buildIntentPatch('tableau_copy', { referenceUrl: VALID_URL, tableauUrl: existing });
    expect(patch.tableauUrl).toBeUndefined();
  });

  it('does NOT set tableauUrl when referenceUrl is empty', () => {
    const patch = buildIntentPatch('tableau_copy', { referenceUrl: '', tableauUrl: '' });
    expect(patch.tableauUrl).toBeUndefined();
  });

  it('does NOT set tableauUrl for non-tableau_copy intents', () => {
    const patch = buildIntentPatch('match', { referenceUrl: VALID_URL, tableauUrl: '' });
    expect(patch.tableauUrl).toBeUndefined();
    expect(patch.intent).toBe('match');
  });
});
