import { join } from 'node:path';
import { PDFParse } from 'pdf-parse';

PDFParse.setWorker(
  join(
    __dirname,
    '..',
    '..',
    'node_modules',
    'pdf-parse',
    'dist',
    'worker',
    'pdf.worker.mjs',
  ),
);
