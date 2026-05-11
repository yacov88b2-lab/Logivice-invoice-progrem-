import { parseTableauViewUrl } from '../rules/_base';

const VALID_STEP_TYPES = new Set([
  'field_extraction', 'field_transform', 'match_transaction',
  'fuzzy_match', 'filter', 'aggregate', 'conditional', 'tableau_table_copy',
]);

const VALID_TABLEAU_MODES = new Set(['raw_sheet', 'target_range']);
const START_CELL_RE = /^[A-Za-z]+[1-9][0-9]*$/;

export function validateAssistantSteps(steps: any[]): string[] {
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
    } else if (s.type === 'tableau_table_copy') {
      // url: required, must parse
      if (!s.config.url) {
        errors.push(`${p}: tableau_table_copy requires url`);
      } else {
        const parsed = parseTableauViewUrl(s.config.url);
        if (!parsed) {
          errors.push(`${p}: tableau_table_copy url must be from dub01.online.tableau.com/site/logivice`);
        }
      }

      // mode: required, must be a known value
      if (!s.config.mode || !VALID_TABLEAU_MODES.has(s.config.mode)) {
        errors.push(`${p}: tableau_table_copy mode must be "raw_sheet" or "target_range"`);
      }

      // targetSheet: required for both modes
      if (!s.config.targetSheet || typeof s.config.targetSheet !== 'string' || !s.config.targetSheet.trim()) {
        errors.push(`${p}: tableau_table_copy requires targetSheet`);
      }

      // target_range extras
      if (s.config.mode === 'target_range') {
        const cell = typeof s.config.startCell === 'string' ? s.config.startCell.trim() : '';
        if (!cell || !START_CELL_RE.test(cell)) {
          errors.push(`${p}: tableau_table_copy target_range requires valid startCell (e.g. A1, B10, AA5)`);
        }
      }

      // includeHeaders: must be boolean if present
      if (s.config.includeHeaders !== undefined && typeof s.config.includeHeaders !== 'boolean') {
        errors.push(`${p}: tableau_table_copy includeHeaders must be boolean`);
      }
    }
  }

  return errors;
}
