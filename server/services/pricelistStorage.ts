import fs from 'fs';
import path from 'path';

/**
 * Pricelist Storage Service
 * Uses local filesystem (Railway has persistent storage)
 */
export class PricelistStorage {
  private localUploadDir: string;

  constructor() {
    this.localUploadDir = path.join(process.cwd(), 'uploads', 'pricelists');
    this.ensureLocalDir();
  }

  private ensureLocalDir(): void {
    if (!fs.existsSync(this.localUploadDir)) {
      fs.mkdirSync(this.localUploadDir, { recursive: true });
    }
  }

  async storeFile(fileName: string, fileBuffer: Buffer): Promise<{ storagePath: string; isSharePoint: boolean }> {
    const localPath = path.join(this.localUploadDir, `${Date.now()}_${fileName}`);
    fs.writeFileSync(localPath, fileBuffer);
    console.log(`[PricelistStorage] Stored locally: ${localPath}`);
    return { storagePath: localPath, isSharePoint: false };
  }

  async retrieveFile(storagePath: string): Promise<Buffer> {
    if (!fs.existsSync(storagePath)) {
      throw new Error('File not found: ' + storagePath);
    }
    return fs.readFileSync(storagePath);
  }

  async deleteFile(storagePath: string): Promise<void> {
    if (fs.existsSync(storagePath)) {
      try {
        fs.unlinkSync(storagePath);
      } catch (error) {
        console.error(`[PricelistStorage] Failed to delete local file:`, error);
      }
    }
  }

  async fileExists(storagePath: string): Promise<boolean> {
    return fs.existsSync(storagePath);
  }
}

export const pricelistStorage = new PricelistStorage();
