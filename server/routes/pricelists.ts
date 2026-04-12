import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { PricelistModel } from '../models/Pricelist';
import { TemplateAnalyzer } from '../services/templateAnalyzer';

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
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage });

// Get all pricelists
router.get('/', (req, res) => {
  try {
    const pricelists = PricelistModel.getAll();
    res.json(pricelists);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pricelists' });
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
    res.status(500).json({ error: 'Failed to fetch pricelist' });
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
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Analyze the uploaded file
    const buffer = fs.readFileSync(req.file.path);
    const templateStructure = TemplateAnalyzer.analyze(buffer);

    const pricelist = PricelistModel.create({
      name,
      customer_name,
      warehouse_code,
      file_path: req.file.path,
      template_structure: templateStructure
    });

    res.status(201).json(pricelist);
  } catch (error) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to create pricelist' });
  }
});

// Update pricelist
router.put('/:id', upload.single('file'), (req, res) => {
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
      // Get old pricelist to delete old file
      const oldPricelist = PricelistModel.getById(id);
      if (oldPricelist && fs.existsSync(oldPricelist.file_path)) {
        fs.unlinkSync(oldPricelist.file_path);
      }
      
      updateData.file_path = req.file.path;
      
      // Re-analyze the file
      const buffer = fs.readFileSync(req.file.path);
      updateData.template_structure = TemplateAnalyzer.analyze(buffer);
    }
    
    const pricelist = PricelistModel.update(id, updateData);
    
    if (!pricelist) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'Pricelist not found' });
    }
    
    res.json(pricelist);
  } catch (error) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to update pricelist' });
  }
});

// Delete pricelist
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pricelist = PricelistModel.getById(id);
    
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }
    
    // Delete the file
    if (fs.existsSync(pricelist.file_path)) {
      fs.unlinkSync(pricelist.file_path);
    }
    
    const success = PricelistModel.delete(id);
    
    if (success) {
      res.status(204).send();
    } else {
      res.status(500).json({ error: 'Failed to delete pricelist' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete pricelist' });
  }
});

// Download pricelist file
router.get('/:id/download', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pricelist = PricelistModel.getById(id);
    
    if (!pricelist) {
      return res.status(404).json({ error: 'Pricelist not found' });
    }
    
    if (!fs.existsSync(pricelist.file_path)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(pricelist.file_path);
  } catch (error) {
    res.status(500).json({ error: 'Failed to download file' });
  }
});

export default router;
