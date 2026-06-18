import { PDFDocument, StandardFonts } from 'pdf-lib';

export async function createTextInvoicePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    'INVOICE #INV-2024-001',
    'Vendor: Acme Corporation',
    'Issue Date: 2024-01-15',
    'Due Date: 2024-02-15',
    'Description          Qty    Unit Price    Amount',
    'Consulting services    10      150.00    1500.00',
    'Design review           5       80.00     400.00',
    'Subtotal: 1900.00',
    'Tax: 190.00',
    'Total: 2090.00 USD',
  ];
  let y = 700;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 24;
  }
  return Buffer.from(await doc.save());
}
