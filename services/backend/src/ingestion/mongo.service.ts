import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';

/** Circular PDFs live in Mongo GridFS; postgres rows hold only the file ref. */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Mongo');
  private client: MongoClient;
  private bucket: GridFSBucket;

  async onModuleInit() {
    const uri =
      process.env.MONGODB_URI ||
      'mongodb://setu_user:setu_password@mongodb:27017/setu_files?authSource=admin';
    this.client = new MongoClient(uri);
    await this.client.connect();
    this.bucket = new GridFSBucket(this.client.db(), { bucketName: 'circulars' });
    this.log.log('Connected to MongoDB (GridFS bucket: circulars)');
  }

  async onModuleDestroy() {
    await this.client?.close();
  }

  storePdf(filename: string, data: Buffer, metadata: Record<string, unknown>): Promise<string> {
    return new Promise((resolve, reject) => {
      const upload = this.bucket.openUploadStream(filename, { metadata });
      upload.on('error', reject);
      upload.on('finish', () => resolve(upload.id.toString()));
      upload.end(data);
    });
  }

  async fetchPdf(fileRef: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of this.bucket.openDownloadStream(new ObjectId(fileRef))) {
        chunks.push(chunk as Buffer);
      }
    } catch (err) {
      throw new NotFoundException(`file ${fileRef} not found in GridFS: ${err}`);
    }
    return Buffer.concat(chunks);
  }
}
