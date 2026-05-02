import express from 'express';
import db from '../db';
import { TableauAPIClient } from '../services/tableauAPI';

const router = express.Router();

router.get('/options', async (req, res) => {
  try {
<<<<<<< Updated upstream
    let customers: string[] = [];

    try {
      const tableauClient = new TableauAPIClient();
      const billingProject = await tableauClient.getBillingProject();

      if (billingProject?.id) {
        const headers: any = await (tableauClient as any).getAuthHeaders?.();
        const siteId: any = await (tableauClient as any).getSiteId?.();
        if (headers && siteId) {
          const response = await fetch(
            `${(tableauClient as any).baseUrl}/api/3.19/sites/${siteId}/projects`,
            { headers }
          );
          if (response.ok) {
            const data = (await response.json()) as any;
            const projects: any[] = data.projects?.project || [];
            customers = projects
              .filter(p => String(p.parentProjectId || '') === String(billingProject.id))
              .map(p => String(p.name || '').trim())
              .filter(Boolean);
          }
        }
      }
    } catch (tableauErr) {
      console.warn('[Tableau] options fetch failed, falling back to DB:', tableauErr instanceof Error ? tableauErr.message : tableauErr);
    }

    // Fallback/augment customers from local DB so the UI can still work even if
    // Tableau config/auth is missing or returns no projects.
    const dbCustomers = (db
      .prepare(
        'SELECT DISTINCT customer_name as name FROM pricelists WHERE customer_name IS NOT NULL AND TRIM(customer_name) <> \'\''
      )
      .all() as any[])
      .map(r => String(r.name || '').trim())
      .filter(Boolean);

    customers = customers.concat(dbCustomers);

=======
    const tableauClient = new TableauAPIClient();
    const billingProject = await tableauClient.getBillingProject();

    let customers: string[] = [];
    if (billingProject?.id) {
      const headers: any = await (tableauClient as any).getAuthHeaders?.();
      const siteId: any = await (tableauClient as any).getSiteId?.();
      if (headers && siteId) {
        const response = await fetch(
          `${(tableauClient as any).baseUrl}/api/3.19/sites/${siteId}/projects`,
          { headers }
        );
        if (response.ok) {
          const data = (await response.json()) as any;
          const projects: any[] = data.projects?.project || [];
          customers = projects
            .filter(p => String(p.parentProjectId || '') === String(billingProject.id))
            .map(p => String(p.name || '').trim())
            .filter(Boolean);
        }
      }
    }

>>>>>>> Stashed changes
    customers = Array.from(new Set(customers)).sort((a, b) => a.localeCompare(b));

    const warehouses = (db
      .prepare('SELECT DISTINCT warehouse_code as code FROM pricelists ORDER BY warehouse_code ASC')
      .all() as any[])
      .map(r => String(r.code))
      .filter(Boolean);

    res.json({ customers, warehouses });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    res.status(500).json({ error: err.message });
  }
});

export default router;
