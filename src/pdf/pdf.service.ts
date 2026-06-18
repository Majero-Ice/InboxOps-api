import './pdf-worker-init';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';
import { PdfType } from './pdf.types';

@Injectable()
export class PdfService {
  constructor(private readonly configService: ConfigService) {}

  async detectType(buffer: Buffer): Promise<PdfType> {
    const text = await this.extractText(buffer);
    const minChars = this.configService.get<number>('PDF_TEXT_MIN_CHARS', 100);
    return text.trim().length > minChars ? 'text' : 'scanned';
  }

  async extractText(buffer: Buffer): Promise<string> {
    return this.withParser(buffer, async (parser) => {
      const result = await parser.getText();
      return result.text;
    });
  }

  async renderPagesToImages(buffer: Buffer): Promise<Buffer[]> {
    const maxPages = this.configService.get<number>('PDF_MAX_VISION_PAGES', 5);
    return this.withParser(buffer, async (parser) => {
      const result = await parser.getScreenshot({
        imageBuffer: true,
        scale: 2,
        first: maxPages,
      });
      return result.pages.map((page) => Buffer.from(page.data));
    });
  }

  private async withParser<T>(
    buffer: Buffer,
    fn: (parser: PDFParse) => Promise<T>,
  ): Promise<T> {
    const parser = new PDFParse({ data: buffer });
    try {
      return await fn(parser);
    } finally {
      await parser.destroy();
    }
  }
}
