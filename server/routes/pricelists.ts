import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { PricelistModel } from '../models/Pricelist';
import { TemplateAnalyzer } from '../services/templateAnalyzer';
import { pricelistStorage } from '../services/pricelistStorage';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'pricelists');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Sanitize filename: remove path traversal characters and limit length
    const safeName = path.basename(file.originalname)
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace unsafe chars with underscore
      .substring(0, 100); // Limit length
    cb(null, uniqueSuffix + '-' + safeName);
  }
});

const upload = multer({ storage });

// Get all pricelists
router.get('/', (req, res) => {
  try {
    const pricelists = PricelistModel.getAll();
    res.json(pricelists);
  } catch (error) {
    console.error('Error fetching pricelists:', error);
    res.status(500).json({ error: 'Failed to fetch pricelists', details: (error as Error).message });
  }
});

// Get pricelist by ID
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pricelist = PricelistModel.getById(id);
    
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }
    
    res.json(pricelist);
  } catch (error) {
    console.error('Error fetching pricelist:', error);
    res.status(500).json({ error: 'Failed to fetch pricelist', details: (error as Error).message });
  }
});

// Upload new pricelist
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const name = req.body.name as string;
    const customer_name = req.body.customer_name as string;
    const warehouse_code = req.body.warehouse_code as string;
    
    if (!name || !customer_name || !warehouse_code) {
      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      // Read file buffer
      const buffer = fs.readFileSync(req.file.path);
      
      // Analyze the uploaded file
      const templateStructure = TemplateAnalyzer.analyze(buffer);
      
      // Store file in SharePoint or local storage
      const fileName = req.file.originalname || `${Date.now()}_${name}.xlsx`;
      const { storagePath, isSharePoint } = await pricelistStorage.storeFile(fileName, buffer);
      
      console.log(`[PricelistRoutes] Stored pricelist in ${isSharePoint ? 'SharePoint' : 'local storage'}: ${storagePath}`);

      const pricelist = PricelistModel.create({
        name,
        customer_name,
        warehouse_code,
        file_path: storagePath,
        template_structure: templateStructure
      });

      res.status(201).json(pricelist);
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
  } catch (error) {
    console.error('Error creating pricelist:', error);
    res.status(500).json({ error: 'Failed to create pricelist', details: (error as Error).message });
  }
});

// Update pricelist
router.put('/:id', upload.single('file'), async (req, res) => {
  try {
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const name = req.body.name as string;
    const customer_name = req.body.customer_name as string;
    const warehouse_code = req.body.warehouse_code as string;
    
    const updateData: any = {};
    if (name) updateData.name = name;
    if (customer_name) updateData.customer_name = customer_name;
    if (warehouse_code) updateData.warehouse_code = warehouse_code;
    
    if (req.file) {
      try {
        // Read file buffer
        const buffer = fs.readFileSync(req.file.path);
        
        // Delete old file from SharePoint/local storage
        const oldPricelist = PricelistModel.getById(id);
        if (oldPricelist) {
          await pricelistStorage.deleteFile(oldPricelist.file_path);
        }
        
        // Store new file in SharePoint or local storage
        const fileName = req.file.originalname || `${Date.now()}_${name || 'pricelist'}.xlsx`;
        const { storagePath, isSharePoint } = await pricelistStorage.storeFile(fileName, buffer);
        
        console.log(`[PricelistRoutes] Updated pricelist stored in ${isSharePoint ? 'SharePoint' : 'local storage'}: ${storagePath}`);
        
        updateData.file_path = storagePath;
        updateData.template_structure = TemplateAnalyzer.analyze(buffer);
      } finally {
        // Clean up temp file
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
    }
    
    const pricelist = PricelistModel.update(id, updateData);
    
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }
    
    res.json(pricelist);
  } catch (error) {
    console.error('Error updating pricelist:', error);
    res.status(500).json({ error: 'Failed to update pricelist', details: (error as Error).message });
  }
});

// Delete pricelist
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pricelist = PricelistModel.getById(id);
    
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }

    db.prepare('DELETE FROM audit_logs WHERE pricelist_id = ?').run(id);
    
    try {
      await pricelistStorage.deleteFile(pricelist.file_path);
    } catch (e) {
      console.warn('[PricelistRoutes] Failed to delete file, continuing:', e);
    }
    
    const success = PricelistModel.delete(id);
    
    if (success) {
      res.status(204).send();
    } else {
      res.status(500).json({ error: 'Failed to delete pricelist' });
    }
  } catch (error) {
    console.error('Error deleting pricelist:', error);
    const err = error instanceof Error ? error : new Error(String(error));
    res.status(500).json({ error: `Failed to delete pricelist. Details: ${err.message}` });
  }
});

// Download pricelist file
router.get('/:id/download', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pricelist = PricelistModel.getById(id);
    
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }
    
    // Check if file exists (SharePoint or local)
    const exists = await pricelistStorage.fileExists(pricelist.file_path);
    if (!exists) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Retrieve file from SharePoint or local storage
    const buffer = await pricelistStorage.retrieveFile(pricelist.file_path);
    
    // Extract filename for download
    const fileName = pricelist.file_path.split('/').pop() || `${pricelist.name}.xlsx`;
    
    // Send file
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ error: 'Failed to download file', details: (error as Error).message });
  }
});

export default router;
