import type { Transaction, LineItem, MatchResult, UnmatchedItem, TemplateStructure } from '../types';
import { TemplateAnalyzer } from './templateAnalyzer';

export class DataMapper {
  static mapTransactions(
    transactions: Transaction[],
    templateStructure: TemplateStructure,
    pricelistBuffer: Buffer
  ): { matches: MatchResult[]; unmatched: UnmatchedItem[] } {
    const matches: MatchResult[] = [];
    const unmatched: UnmatchedItem[] = [];

    // Build lookup index from template structure
    const lineItemIndex = new Map<string, { item: LineItem; sheetName: string }[]>();
    
    console.log('[DataMapper] Building index from template structure...');
    let indexCount = 0;
    
    for (const sheet of templateStructure.sheets) {
      if (sheet.type !== 'invoice') continue;
      
      for (const item of sheet.lineItems) {
        const key = this.createMatchKey(item.segment, item.clause, item.category, item.unitOfMeasure, item.remark);
        
        if (!lineItemIndex.has(key)) {
          lineItemIndex.set(key, []);
        }
        lineItemIndex.get(key)!.push({ item, sheetName: sheet.name });
        indexCount++;
        
        // Log first few index entries for debugging
        if (indexCount <= 5) {
          console.log(`[DataMapper] Index entry ${indexCount}: ${key}`);
          console.log(`  -> Segment: "${item.segment}", Clause: "${item.clause}", Category: "${item.category}", UOM: "${item.unitOfMeasure}", Remark: "${item.remark}"`);
        }
      }
    }
    console.log(`[DataMapper] Indexed ${indexCount} line items`);

    // Match each transaction
    console.log(`[DataMapper] Matching ${transactions.length} transactions...`);
    let matchCount = 0;
    let fuzzyCount = 0;
    let noMatchCount = 0;
    
    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      const matchKey = this.createMatchKey(
        transaction.segment,
        transaction.movementType,
        transaction.category,
        transaction.unitOfMeasure,
        transaction.description
      );

      // Log first few transaction keys for debugging
      if (i < 5) {
        console.log(`[DataMapper] Transaction ${i}: ${matchKey}`);
        console.log(`  -> Segment: "${transaction.segment}", Movement: "${transaction.movementType}", Category: "${transaction.category}", UOM: "${transaction.unitOfMeasure}", Desc: "${transaction.description}", Qty: ${transaction.quantity}`);
      }

      const candidates = lineItemIndex.get(matchKey);

      if (!candidates || candidates.length === 0) {
        // Try fuzzy matching
        const fuzzyMatches = this.fuzzyMatch(transaction, templateStructure);
        
        if (fuzzyMatches.length === 0) {
          noMatchCount++;
          unmatched.push({
            transaction,
            reason: 'No matching line item found in pricelist'
          });
        } else if (fuzzyMatches.length === 1) {
          fuzzyCount++;
          matches.push({
            lineItem: fuzzyMatches[0].item,
            transaction,
            sheetName: fuzzyMatches[0].sheetName,
            confidence: fuzzyMatches[0].score,
            matchReason: `Fuzzy match (score: ${(fuzzyMatches[0].score * 100).toFixed(0)}%)`
          });
        } else {
          fuzzyCount++;
          // Multiple close matches - pick the best one and note alternatives
          const best = fuzzyMatches[0];
          matches.push({
            lineItem: best.item,
            transaction,
            sheetName: best.sheetName,
            confidence: best.score,
            matchReason: `Best fuzzy match (score: ${(best.score * 100).toFixed(0)}%), alternatives available`
          });
        }
      } else if (candidates.length === 1) {
        matchCount++;
        matches.push({
          lineItem: candidates[0].item,
          transaction,
          sheetName: candidates[0].sheetName,
          confidence: 1.0,
          matchReason: 'Exact match on all fields'
        });
      } else {
        // Multiple exact matches - ambiguous
        unmatched.push({
          transaction,
          reason: 'Multiple identical line items in pricelist',
          possibleMatches: candidates.map(c => c.item)
        });
      }
    }
    
    console.log(`[DataMapper] Results: ${matchCount} exact matches, ${fuzzyCount} fuzzy matches, ${noMatchCount} unmatched (${unmatched.length} total unmatched)`);

    return { matches, unmatched };
  }

  private static createMatchKey(
    segment: string,
    clause: string,
    category: string,
    uom: string,
    remark: string
  ): string {
    return `${this.normalize(segment)}|${this.normalize(clause)}|${this.normalize(category)}|${this.normalize(uom)}|${this.normalize(remark)}`;
  }

  private static normalize(str: string): string {
    return str.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private static fuzzyMatch(
    transaction: Transaction,
    templateStructure: TemplateStructure
  ): { item: LineItem; sheetName: string; score: number }[] {
    const matches: { item: LineItem; sheetName: string; score: number }[] = [];

    for (const sheet of templateStructure.sheets) {
      if (sheet.type !== 'invoice') continue;

      for (const item of sheet.lineItems) {
        let score = 0;

        // Segment match (high weight)
        if (this.normalize(item.segment) === this.normalize(transaction.segment)) {
          score += 0.5;
        }

        // Clause/Movement type match (high weight)
        const itemClause = this.normalize(item.clause);
        const transMovement = this.normalize(transaction.movementType);
        if (itemClause === transMovement || 
            itemClause.includes(transMovement) || 
            transMovement.includes(itemClause)) {
          score += 0.4;
        }

        // Category match (medium weight)
        if (this.normalize(item.category) === this.normalize(transaction.category)) {
          score += 0.2;
        }

        // UOM match (medium weight)
        if (this.normalize(item.unitOfMeasure) === this.normalize(transaction.unitOfMeasure)) {
          score += 0.2;
        }

        // Description/Remark match (only if both have content)
        const itemRemark = this.normalize(item.remark);
        const transDesc = this.normalize(transaction.description);
        if (itemRemark && transDesc && itemRemark !== 'nan' && transDesc !== 'nan') {
          if (itemRemark.includes(transDesc) || transDesc.includes(itemRemark)) {
            score += 0.2;
          }
        }

        // Only include if we have a reasonable match
        if (score >= 0.7) {
          matches.push({ item, sheetName: sheet.name, score });
        }
      }
    }

    // Sort by score (highest first)
    matches.sort((a, b) => b.score - a.score);
    
    // If top match has significantly higher score than others, only return that one
    if (matches.length > 1 && matches[0].score - matches[1].score > 0.2) {
      return [matches[0]];
    }
    
    // Otherwise return top 3 for user to choose
    return matches.slice(0, 3);
  }

  static aggregateQuantities(matches: MatchResult[]): Map<string, { qty: number; items: MatchResult[] }> {
    const aggregated = new Map<string, { qty: number; items: MatchResult[] }>();

    for (const match of matches) {
      const key = TemplateAnalyzer.getLineItemKey(match.lineItem);
      
      if (!aggregated.has(key)) {
        aggregated.set(key, { qty: 0, items: [] });
      }
      
      const entry = aggregated.get(key)!;
      entry.qty += match.transaction.quantity;
      entry.items.push(match);
    }

    return aggregated;
  }
}
