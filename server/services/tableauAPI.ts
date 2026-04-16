import type { Transaction } from '../types';

// Tableau API Configuration - loaded from environment variables
const TABLEAU_BASE_URL = process.env.TABLEAU_SERVER || 'https://dub01.online.tableau.com';
const TABLEAU_TOKEN_NAME = process.env.TABLEAU_TOKEN_NAME || '';
const TABLEAU_TOKEN_SECRET = process.env.TABLEAU_TOKEN_VALUE || '';
const TABLEAU_SITE = process.env.TABLEAU_SITE || 'logivice';

export class TableauAPIClient {
  private baseUrl: string;
  private authToken: string | null = null;
  private siteId: string | null = null;

  constructor() {
    this.baseUrl = TABLEAU_BASE_URL;
  }

  async authenticate(): Promise<string | null> {
    try {
      console.log('[Tableau] Attempting authentication...');
      console.log('[Tableau] Token name:', TABLEAU_TOKEN_NAME);
      console.log('[Tableau] Base URL:', this.baseUrl);
      const response = await fetch(`${this.baseUrl}/api/3.19/auth/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          credentials: {
            personalAccessTokenName: TABLEAU_TOKEN_NAME,
            personalAccessTokenSecret: TABLEAU_TOKEN_SECRET,  // Send FULL token, not split
            site: {
              contentUrl: 'logivice'
            }
          }
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Tableau] Authentication failed:', response.status, errorText);
        return null;
      }
      
      const data = await response.json();
      this.authToken = data.credentials?.token || null;
      this.siteId = data.credentials?.site?.id || null;
      console.log('[Tableau] Authentication successful, token stored:', !!this.authToken, 'siteId:', this.siteId);
      return this.authToken;
    } catch (error) {
      console.error('[Tableau] Authentication error:', error);
      return null;
    }
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (!this.authToken) {
      console.log('[Tableau] No auth token, calling authenticate...');
      await this.authenticate();
    }
    console.log('[Tableau] Using auth token:', this.authToken ? this.authToken.substring(0, 10) + '...' : 'EMPTY');
    return {
      'X-Tableau-Auth': this.authToken || '',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
  }

  // Get site ID (from auth response or fetch if needed)
  private async getSiteId(): Promise<string | null> {
    if (this.siteId) {
      console.log('[Tableau] Using site ID from auth:', this.siteId);
      return this.siteId;
    }
    console.log('[Tableau] Getting site ID for logivice...');
    const headers = await this.getAuthHeaders();
    const response = await fetch(
      `${this.baseUrl}/api/3.19/sites/logivice`,
      { headers }
    );
    if (!response.ok) {
      console.error('[Tableau] Failed to get site ID:', response.status, await response.text());
      return null;
    }
    const data = await response.json() as any;
    const siteId = data.site?.id || null;
    console.log('[Tableau] Site ID:', siteId);
    return siteId;
  }

  // Get Billing 2025 project
  async getBillingProject(): Promise<any | null> {
    const headers = await this.getAuthHeaders();
    const siteId = await this.getSiteId();
    if (!siteId) return null;

    const response = await fetch(
      `${this.baseUrl}/api/3.19/sites/${siteId}/projects`,
      { headers }
    );

    if (!response.ok) {
      console.error('Failed to get projects:', await response.text());
      return null;
    }

    const data = await response.json() as any;
    const projects = data.projects?.project || [];
    
    // Find Billing 2025 project
    return projects.find((p: any) => 
      p.name?.toLowerCase().includes('billing 2025') || 
      p.name?.toLowerCase().includes('billing2025')
    ) || null;
  }

  // Get customer subproject (e.g., Afimilk) under Billing 2025
  async getCustomerProject(billingProjectId: string, customerName: string): Promise<any | null> {
    const headers = await this.getAuthHeaders();
    const siteId = await this.getSiteId();
    if (!siteId) return null;

    const response = await fetch(
      `${this.baseUrl}/api/3.19/sites/${siteId}/projects`,
      { headers }
    );

    if (!response.ok) {
      console.error('Failed to get customer projects:', await response.text());
      return null;
    }

    const data = await response.json() as any;
    const projects = data.projects?.project || [];

    const normalizedInput = String(customerName || '').trim();
    const lower = normalizedInput.toLowerCase();
    const candidateNames = new Set<string>([normalizedInput]);

    // Alias mapping: UI/display name may differ from Tableau project name
    if (lower.includes('afimilk')) {
      candidateNames.add('Afimilk');
    }

    const candidates = Array.from(candidateNames)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => c.toLowerCase());

    // Find matching customer project UNDER the Billing 2025 project only
    return (
      projects.find((p: any) => {
        const parentId = String(p.parentProjectId ?? p.parentProject?.id ?? '');
        if (parentId !== String(billingProjectId)) return false;
        const name = String(p.name || '').toLowerCase();
        return candidates.some((c) => name === c || name.includes(c));
      }) || null
    );
  }

  // Get workbooks for customer (e.g., AVT HKG)
  async getCustomerWorkbooks(customerName: string, warehouseCode?: string, customerProjectId?: string): Promise<any[]> {
    const headers = await this.getAuthHeaders();
    const siteId = await this.getSiteId();
    if (!siteId) return [];

    // Fetch all pages of workbooks
    let allWorkbooks: any[] = [];
    let pageNumber = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore && pageNumber <= 10) { // Max 10 pages = 1000 workbooks
      const response = await fetch(
        `${this.baseUrl}/api/3.19/sites/${siteId}/workbooks?pageSize=${pageSize}&pageNumber=${pageNumber}`,
        { headers }
      );

      if (!response.ok) {
        console.error('[Tableau] Failed to get workbooks page', pageNumber, await response.text());
        break;
      }

      const data = await response.json() as any;
      const workbooks = data.workbooks?.workbook || [];
      allWorkbooks = allWorkbooks.concat(workbooks);
      
      console.log(`[Tableau] Page ${pageNumber}: fetched ${workbooks.length} workbooks, total: ${allWorkbooks.length}`);
      
      if (workbooks.length < pageSize) {
        hasMore = false;
      } else {
        pageNumber++;
      }
    }

    console.log('[Tableau] First 20 workbook names:', allWorkbooks.slice(0, 20).map((w: any) => w.name).join(', '));

    // If we know the customer project, prefer workbooks that live under it.
    // This prevents false negatives where workbook name doesn't contain the full customer display name.
    if (customerProjectId) {
      const filteredByProject = allWorkbooks.filter((w: any) => String(w.project?.id || '') === String(customerProjectId));
      if (filteredByProject.length > 0) {
        allWorkbooks = filteredByProject;
        console.log(`[Tableau] Filtered workbooks by projectId=${customerProjectId}: ${allWorkbooks.length}`);
      } else {
        console.log(`[Tableau] No workbooks matched projectId=${customerProjectId}; falling back to global workbook search`);
      }
    }

    // Normalize customer name for workbook matching (UI name != Tableau workbook naming)
    let workbookCustomerKey = String(customerName || '').trim().toLowerCase();
    if (workbookCustomerKey.includes('afimilk')) {
      workbookCustomerKey = 'afimilk';
    }
    
    // Filter by customer name AND billing keyword
    // Look for SPD and AVT open orders workbook across ALL workbooks
    const spdAvtWorkbook = allWorkbooks.find((w: any) => 
      w.name?.toLowerCase().includes('spd and avt open orders') ||
      w.name?.toLowerCase().includes('spd & avt open orders')
    );
    
    if (spdAvtWorkbook) {
      console.log('[Tableau] Found SPD and AVT workbook:', spdAvtWorkbook.name);
      if (customerName.toLowerCase() === 'avt') {
        console.log('[Tableau] Using SPD and AVT workbook for AVT customer');
        return [spdAvtWorkbook];
      }
    } else {
      console.log('[Tableau] SPD and AVT workbook NOT found in', allWorkbooks.length, 'workbooks');
      console.log('[Tableau] Looking for SPD workbooks:', allWorkbooks.filter((w: any) => w.name?.toLowerCase().includes('spd')).map((w: any) => w.name).join(', '));
    }
    
    // Original billing workbook search as fallback
    const billingWorkbooks = allWorkbooks.filter((w: any) => {
      const nameLower = w.name?.toLowerCase() || '';
      const hasBilling = nameLower.includes('billing') || 
                        nameLower.includes('invoice') || 
                        nameLower.includes('open orders') ||
                        nameLower.includes('orders');
      return hasBilling;
    });
    
    const customerWorkbooks = billingWorkbooks.filter((w: any) => {
      const nameLower = w.name?.toLowerCase() || '';
      const hasCustomer = nameLower.includes(workbookCustomerKey);
      console.log(`[Tableau] Checking '${w.name}': customer=${hasCustomer}`);
      return hasCustomer;
    });
    console.log('[Tableau] Billing workbooks matching customer:', customerWorkbooks.map((w: any) => w.name).join(', '));
    
    // If warehouse code specified, further filter
    if (warehouseCode) {
      const wh = warehouseCode.toLowerCase();
      // Match warehouse code or partial (e.g., HK matches HKG)
      const warehouseWorkbooks = customerWorkbooks.filter((w: any) => {
        const name = w.name?.toLowerCase() || '';
        return name.includes(wh) || 
               (wh.length >= 2 && name.includes(wh.substring(0, 2))) ||
               (wh.includes('hk') && name.includes('hong kong')) ||
               (wh.includes('hk') && name.includes('hk'));
      });
      console.log('[Tableau] Workbooks matching warehouse:', warehouseWorkbooks.map((w: any) => w.name).join(', '));
      // Return warehouse-specific if found, otherwise all customer workbooks
      return warehouseWorkbooks.length > 0 ? warehouseWorkbooks : customerWorkbooks;
    }
    
    return customerWorkbooks;
  }

  // Get views in workbook (e.g., Inbound, Outbound, Storage)
  async getWorkbookViews(workbookId: string): Promise<any[]> {
    const headers = await this.getAuthHeaders();
    const siteId = await this.getSiteId();
    if (!siteId) return [];

    const response = await fetch(
      `${this.baseUrl}/api/3.19/sites/${siteId}/workbooks/${workbookId}/views`,
      { headers }
    );

    if (!response.ok) {
      console.error('Failed to get views:', await response.text());
      return [];
    }

    const data = await response.json() as any;
    return data.views?.view || [];
  }

  // Get available filters for a view
  async getViewFilters(viewId: string): Promise<any[]> {
    const headers = await this.getAuthHeaders();
    const siteId = await this.getSiteId();
    if (!siteId) return [];

    const response = await fetch(
      `${this.baseUrl}/api/3.19/sites/${siteId}/views/${viewId}/filters`,
      { headers }
    );

    if (!response.ok) {
      console.error('[Tableau] Failed to get view filters:', await response.text());
      return [];
    }

    const data = await response.json() as any;
    return data.filters?.filter || [];
  }
  async queryViewData(viewId: string, filters: Record<string, string>, dateRange?: {start: string, end: string}): Promise<any> {
    const headers = await this.getAuthHeaders();
    const siteId = await this.getSiteId();
    if (!siteId) return null;

    // Don't rely on server-side filters (often inconsistent across views) - fetch and filter client-side.
    // Prefer crosstab CSV export which is typically more complete than /data.
    const crosstabUrl = `${this.baseUrl}/api/3.19/sites/${siteId}/views/${viewId}/crosstab?includeAllColumns=true`;
    const dataUrl = `${this.baseUrl}/api/3.19/sites/${siteId}/views/${viewId}/data`;
    console.log('[Tableau] Querying view crosstab:', crosstabUrl);

    let response = await fetch(crosstabUrl, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Tableau] Failed to query view crosstab, falling back to /data:', response.status, errorText.substring(0, 200));
      console.log('[Tableau] Querying view data:', dataUrl);
      response = await fetch(dataUrl, { headers });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Tableau] Failed to query view data:', response.status, errorText.substring(0, 200));
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    console.log('[Tableau] View data response type:', contentType, 'length:', text.length);
    
    // Handle CSV response
    let result: any;
    if (contentType.includes('csv') || text.startsWith('CO')) {
      result = this.parseCSVData(text);
    } else {
      try {
        result = JSON.parse(text);
      } catch (e) {
        console.error('[Tableau] Failed to parse view data as JSON:', text.substring(0, 200));
        return null;
      }
    }
    
    // Apply client-side date filtering if dateRange provided
    if (dateRange && result.data && Array.isArray(result.data)) {
      const beforeCount = result.data.length;
      result.data = this.filterByDateRange(result.data, dateRange.start, dateRange.end);
      console.log(`[Tableau] Client-side date filtering: ${beforeCount} -> ${result.data.length} rows`);
    }
    
    return result;
  }
  
  // Filter data rows by date range (client-side)
  private filterByDateRange(data: any[], startDate: string, endDate: string): any[] {
    // Parse dates as local dates to avoid timezone issues
    const start = this.parseLocalDate(startDate);
    const end = this.parseLocalDate(endDate);
    end.setHours(23, 59, 59, 999); // Include full end day
    
    return data.filter(row => {
      // Find date column - check various common names
      const dateValue = row['created_at'] || 
                       row['Created At'] || 
                       row['Day of Created At'] ||
                       row['Day of Created At (Stats)'] ||
                       row['Month of Created At'] ||
                       row['Month of Created At (Orders)'] ||
                       row['Inbound at'] || // Afimilk NZ Inbound view
                       row['Shipped out'] || // Afimilk NZ Outbound view
                       row['Inbound At'] ||
                       row['shipped_out'];
      
      if (!dateValue) return true; // Keep rows without dates (can't filter)
      
      const rowDate = this.parseDateValue(dateValue);
      if (!rowDate || isNaN(rowDate.getTime())) return true; // Keep rows with invalid dates
      
      return rowDate >= start && rowDate <= end;
    });
  }

  // Parse a date string as local date (YYYY-MM-DD) to avoid timezone issues
  private parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed in JS Date
  }

  // Parse various date value formats from Tableau
  private parseDateValue(dateValue: any): Date | null {
    if (!dateValue) return null;
    
    // If it's already a Date object
    if (dateValue instanceof Date) return dateValue;
    
    const str = String(dateValue).trim();
    
    // Try ISO format first
    const isoDate = new Date(str);
    if (!isNaN(isoDate.getTime())) return isoDate;
    
    // Try "1 February 2026" format (Tableau default)
    const tableauMatch = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
    if (tableauMatch) {
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                          'july', 'august', 'september', 'october', 'november', 'december'];
      const day = parseInt(tableauMatch[1]);
      const month = monthNames.indexOf(tableauMatch[2].toLowerCase());
      const year = parseInt(tableauMatch[3]);
      if (month >= 0) {
        return new Date(year, month, day);
      }
    }
    
    // Try MM/DD/YYYY format
    const usMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) {
      return new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
    }
    
    return null;
  }

  // Parse CSV data from Tableau view - properly handles quoted fields with commas
  private parseCSVData(csvText: string): any {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      console.log('[Tableau] CSV data has insufficient rows');
      return { data: [] };
    }
    
    // Parse header
    const headers = this.parseCSVLine(lines[0]);
    console.log('[Tableau] CSV headers:', headers.join(', '));
    
    // Parse data rows
    const data = lines.slice(1).map(line => {
      const values = this.parseCSVLine(line);
      const row: any = {};
      headers.forEach((header, i) => {
        row[header] = values[i] || '';
      });
      return row;
    });
    
    console.log('[Tableau] Parsed CSV rows:', data.length);
    return { data };
  }

  // Parse a single CSV line respecting quoted fields
  private parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote inside quoted field
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of field
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Don't forget the last field
    values.push(current.trim());
    
    // Clean up quotes from values
    return values.map(v => v.replace(/^"|"$/g, ''));
  }

  // Fetch raw view data along with transactions
  async fetchTransactionsWithRawData(
    startDate: string,
    endDate: string,
    customer?: string,
    warehouse?: string
  ): Promise<{ transactions: Transaction[]; rawViewData: Map<string, any[]> }> {
    console.log(`Fetching from Tableau: ${customer} - ${warehouse}, ${startDate} to ${endDate}`);

    const rawViewData = new Map<string, any[]>();

    try {
      // Ensure authenticated
      if (!this.authToken) {
        await this.authenticate();
      }

      // Step 1: Get Billing 2025 project
      const billingProject = await this.getBillingProject();
      if (!billingProject) {
        console.log('Billing 2025 project not found, using mock data');
        return { 
          transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
          rawViewData 
        };
      }
      console.log('Found Billing project:', billingProject.name);

      // Step 2: Get customer subproject
      if (!customer) {
        console.log('No customer specified, using mock data');
        return { 
          transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
          rawViewData 
        };
      }

      const customerProject = await this.getCustomerProject(billingProject.id, customer);
      if (!customerProject) {
        console.log(`Customer project '${customer}' not found, using mock data`);
        return { 
          transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
          rawViewData 
        };
      }
      console.log('Found customer project:', customerProject.name);

      // Step 3: Get workbooks (prefer those under the customer project)
      const workbooks = await this.getCustomerWorkbooks(customer, warehouse, customerProject.id);
      if (workbooks.length === 0) {
        console.log('No workbooks found, using mock data');
        return { 
          transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
          rawViewData 
        };
      }
      console.log(`Found ${workbooks.length} workbook(s):`, workbooks.map((w: any) => w.name));

      // Step 4: Get views from first matching workbook
      const targetWorkbook = workbooks[0];
      const views = await this.getWorkbookViews(targetWorkbook.id);
      if (views.length === 0) {
        console.log('No views found, using mock data');
        return { 
          transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
          rawViewData 
        };
      }
      console.log(`Found ${views.length} views:`, views.map((v: any) => v.name));

      // Step 5: Query each view for data
      const allTransactions: Transaction[] = [];
      
      // Date filters - use lowercase created_at to match the actual field name
      const dateFilters = {
        'created_at': `${startDate}:${endDate}`
      };

      console.log(`[Tableau] Date filters: ${JSON.stringify(dateFilters)}`);

      for (const view of views) {
        const segment = this.mapViewNameToSegment(view.name);
        console.log(`[Tableau] View '${view.name}' mapped to segment: ${segment || 'SKIPPED'}`);
        
        // Debug: Query available filters for this view
        const availableFilters = await this.getViewFilters(view.id);
        if (availableFilters.length > 0) {
          console.log(`[Tableau] Available filters for '${view.name}':`, availableFilters.map((f: any) => f.name).join(', '));
        }
        
        const viewData = await this.queryViewData(view.id, {}, {start: startDate, end: endDate});
        
        if (viewData && viewData.data) {
          // Store RAW data for Excel sheets
          rawViewData.set(view.name, viewData.data);
          
          if (segment) {
            const transactions = this.transformTableauData(
              viewData.data, 
              segment,
              customer || 'Unknown', 
              warehouse || 'Default'
            );
            allTransactions.push(...transactions);
            console.log(`View '${view.name}': ${transactions.length} transactions`);
          }
        }
      }

      if (allTransactions.length === 0) {
        console.log('No data from Tableau views, using mock data');
        return { 
          transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
          rawViewData 
        };
      }

      console.log(`Total transactions from Tableau: ${allTransactions.length}`);
      return { transactions: allTransactions, rawViewData };

    } catch (error) {
      console.error('Error fetching from Tableau:', error);
      return { 
        transactions: this.getMockTransactions(startDate, endDate, customer, warehouse),
        rawViewData 
      };
    }
  }

      // Keep backward compatibility - old method calls new one
      async fetchTransactions(
        startDate: string,
        endDate: string,
        customer?: string,
        warehouse?: string
      ): Promise<Transaction[]> {
        const result = await this.fetchTransactionsWithRawData(startDate, endDate, customer, warehouse);
        return result.transactions;
      }
  private mapViewNameToSegment(viewName: string): string | null {
    const name = viewName.toLowerCase();
    if (name.includes('inbound') || name === 'in') return 'Inbound';
    if (name.includes('outbound') || name === 'out') return 'Outbound';
    if (name.includes('storage')) return 'Storage';
    if (name.includes('vas') || name.includes('value added')) return 'VAS';
    if (name.includes('exw')) return 'EXW';
    if (name.includes('manag')) return 'Management';
    if (name === 'transactions') return 'Transactions'; // Main transaction view
    if (name.includes('pivot out')) return 'Outbound'; // Pivot for outbound
    if (name.includes('pivot')) return 'Pivot'; // General pivot/summary
    if (name.includes('eor') || name.includes('ior')) return 'EOR_IOR';
    return null;
  }

  // Transform Tableau data to Transaction objects
  private transformTableauData(
    data: any[], 
    segment: string,
    customer: string, 
    warehouse: string
  ): Transaction[] {
    return data.map((row: any, index: number) => {
      // Smart field detection based on available columns
      const hasType = row['Type'] !== undefined;
      const hasOrderType = row['order_type'] !== undefined;
      const hasName = row['Name'] !== undefined;
      const hasDisplayName = row['Display Name'] !== undefined;
      const hasDescription = row['Description (Part Masters)'] !== undefined || row['Description'] !== undefined;
      const hasQTY = row['QTY'] !== undefined;
      const hasValue = row['Value'] !== undefined;
      const hasDistinctCount = row['Distinct count of Ref (Orders)'] !== undefined;
      const hasDomInt = row["Dom/Int'l"] !== undefined;
      
      // For Transactions view, use the Type column as segment (Inbound/Outbound)
      let actualSegment = segment;
      if (segment === 'Transactions' && hasType) {
        const typeValue = String(row['Type']).toLowerCase();
        if (typeValue.includes('inbound')) actualSegment = 'Inbound';
        else if (typeValue.includes('outbound')) actualSegment = 'Outbound';
      }
      
      // For Pivot Out view, it's always Outbound
      if (segment === 'Outbound' && hasDomInt) {
        actualSegment = 'Outbound';
      }
      
      // For Management view, determine from order_type
      if (segment === 'Management' && hasOrderType) {
        const orderTypeValue = String(row['order_type']).toLowerCase();
        if (orderTypeValue.includes('inbound')) actualSegment = 'Inbound';
        else if (orderTypeValue.includes('outbound')) actualSegment = 'Outbound';
      }
      
      // Extract quantity from various possible column names
      let qty = 0;
      if (hasQTY) {
        qty = parseFloat(row['QTY']) || 0;
      } else if (hasDistinctCount) {
        qty = parseFloat(row['Distinct count of Ref (Orders)']) || 0;
      } else if (hasValue) {
        qty = parseFloat(row['Value']) || 0;
      }
      
      // Extract movement type / clause - default to "Per Order" for Transactions view
      let movementType = 'Per Order';
      if (segment === 'Transactions' || segment === 'Inbound' || segment === 'Outbound') {
        // Transactions view uses Per Order by default
        movementType = 'Per Order';
      } else if (hasOrderType) {
        movementType = row['order_type'];
      } else if (hasDomInt) {
        movementType = 'Per Order';
      }
      
      // Extract category based on segment and available data
      let category = 'General';
      if (actualSegment === 'Inbound') {
        category = 'General';
      } else if (actualSegment === 'Outbound') {
        // For outbound, check if we have Dom/Int'l info
        if (hasDomInt) {
          const domIntValue = String(row["Dom/Int'l"]).toLowerCase();
          if (domIntValue.includes('dom')) {
            category = 'Domestic';
          } else if (domIntValue.includes('int')) {
            category = 'International';
          }
        } else {
          // Default for outbound without Dom/Int data
          category = 'Domestic';
        }
      } else if (hasName && row['Name']) {
        // For other views, use Name as category
        category = row['Name'];
      } else if (hasDisplayName && row['Display Name']) {
        category = row['Display Name'];
      }
      
      // Extract description/remark
      let description = '';
      if (hasDescription) {
        description = row['Description (Part Masters)'] || row['Description'];
      } else if (hasDisplayName) {
        description = row['Display Name'];
      }
      
      // Extract UOM
      let uom = 'order';
      if (row['Name (Warehouses)']) {
        uom = row['Name (Warehouses)'];
      }
      
      // Extract date (use same heuristics as filterByDateRange so date-range requests are accurate)
      const dateValue = row['created_at'] ||
        row['Created At'] ||
        row['Day of Created At'] ||
        row['Day of Created At (Stats)'] ||
        row['Month of Created At'] ||
        row['Month of Created At (Orders)'] ||
        row['Inbound at'] ||
        row['Shipped out'] ||
        row['Inbound At'] ||
        row['shipped_out'] ||
        row['Date'];

      const parsedDate = this.parseDateValue(dateValue);
      const date = parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      
      // Extract order ID
      const orderId = row['Ref (Orders)'] || row['Order Number'] || `TXN-${index}`;
      
      return {
        id: orderId,
        date: date,
        orderNumber: orderId,
        customer: customer,
        warehouse: warehouse,
        segment: actualSegment,
        movementType: movementType,
        category: category,
        unitOfMeasure: uom,
        description: description,
        quantity: qty
      };
    });
  }

  private getMockTransactions(
    startDate: string,
    endDate: string,
    customer?: string,
    warehouse?: string
  ): Transaction[] {
    const safeCustomer = customer || 'AudioCodes';
    const safeWarehouse = warehouse || 'CZ';

    const start = new Date(startDate);
    const end = new Date(endDate);
    const startMs = Number.isFinite(start.getTime()) ? start.getTime() : Date.now();
    const endMs = Number.isFinite(end.getTime()) ? end.getTime() : startMs;
    const minMs = Math.min(startMs, endMs);
    const maxMs = Math.max(startMs, endMs);

    const formatDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const pickDate = (idx: number, total: number) => {
      if (minMs === maxMs) return formatDate(minMs);
      const t = total <= 1 ? 0 : idx / (total - 1);
      return formatDate(minMs + (maxMs - minMs) * t);
    };

    // Generate mock transactions within the requested date range so invoices never come back empty
    const mockTransactions: Transaction[] = [
      // Inbound transactions
      { id: '1', date: pickDate(0, 12), orderNumber: 'ORD-001', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Inbound', movementType: 'Per Order', category: 'General', unitOfMeasure: 'order', description: '', quantity: 5 },
      { id: '2', date: pickDate(1, 12), orderNumber: 'ORD-002', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Inbound', movementType: 'Per Unit Scan', category: 'Per Pallet', unitOfMeasure: 'pallet', description: 'only if possible to scan 1 bar/QR code per pallet', quantity: 3 },
      { id: '3', date: pickDate(2, 12), orderNumber: 'ORD-003', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Inbound', movementType: 'Per Unit Scan', category: 'Per Box', unitOfMeasure: 'box', description: 'only if possible to scan 1 bar/QR code per box', quantity: 10 },
      { id: '4', date: pickDate(3, 12), orderNumber: 'ORD-004', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Inbound', movementType: 'Per Unit Scan', category: 'Per Item', unitOfMeasure: 'line', description: '', quantity: 25 },
      { id: '5', date: pickDate(4, 12), orderNumber: 'ORD-005', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Inbound', movementType: 'Per Unit Scan', category: 'Per Serial', unitOfMeasure: 'each', description: '', quantity: 150 },

      // Outbound transactions
      { id: '6', date: pickDate(5, 12), orderNumber: 'ORD-006', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Outbound', movementType: 'Per order', category: 'Domestic', unitOfMeasure: 'order', description: '', quantity: 8 },
      { id: '7', date: pickDate(6, 12), orderNumber: 'ORD-007', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Outbound', movementType: 'Per order', category: 'International', unitOfMeasure: 'order', description: '', quantity: 2 },
      { id: '8', date: pickDate(7, 12), orderNumber: 'ORD-008', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Outbound', movementType: 'Per Unit Scan', category: 'Per Pallet', unitOfMeasure: 'pallet', description: 'only if possible to scan 1 bar/QR code per pallet', quantity: 2 },
      { id: '9', date: pickDate(8, 12), orderNumber: 'ORD-009', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Outbound', movementType: 'Per Unit Scan', category: 'Per Box', unitOfMeasure: 'box', description: 'only if possible to scan 1 bar/QR code per box', quantity: 5 },
      { id: '10', date: pickDate(9, 12), orderNumber: 'ORD-010', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Outbound', movementType: 'Per Unit Scan', category: 'Per Item', unitOfMeasure: 'line', description: '', quantity: 20 },
      { id: '11', date: pickDate(10, 12), orderNumber: 'ORD-011', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Outbound', movementType: 'Per Unit Scan', category: 'Per Serial', unitOfMeasure: 'each', description: '', quantity: 400 },

      // Unmatched transaction for testing error handling
      { id: '12', date: pickDate(11, 12), orderNumber: 'ORD-012', customer: safeCustomer, warehouse: safeWarehouse, segment: 'Storage', movementType: 'Per Unit', category: 'Monthly', unitOfMeasure: 'pallet', description: 'Unknown service type', quantity: 5 },
    ];

    return mockTransactions;
  }

  async testConnection(): Promise<boolean> {
    const token = await this.authenticate();
    return token !== null;
  }
}

export default new TableauAPIClient();
