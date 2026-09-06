import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

export type SalesReportFilters = { from?: Date; to?: Date; repId?: string; status?: string; productId?: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown) => Number(value ?? 0);

export async function aggregateSales(tx: Prisma.TransactionClient, organizationId: string, quoteScope: Prisma.QuoteWhereInput, filters: SalesReportFilters) {
  const orders = await tx.order.findMany({
    where: {
      quote: { organizationId, AND: [quoteScope], ...(filters.repId ? { ownerId: filters.repId } : {}) },
      ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } } : {}),
      ...(filters.status ? { state: filters.status as never } : {}),
      ...(filters.productId ? { lines: { some: { productId: filters.productId } } } : {}),
    },
    include: { quote: { include: { owner: { select: { id: true, name: true } } } }, lines: true, invoices: { select: { amount: true, paidAmount: true, state: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const rows = orders.map((order) => {
    const lines = filters.productId ? order.lines.filter((line) => line.productId === filters.productId) : order.lines;
    const total = lines.reduce((sum, line) => { const snapshot = record(line.snapshot); return sum + amount(snapshot.net) + amount(snapshot.tax); }, 0);
    const invoiced = order.invoices.reduce((sum, invoice) => sum + amount(invoice.amount), 0);
    const paid = order.invoices.reduce((sum, invoice) => sum + amount(invoice.paidAmount), 0);
    return { orderId: order.id, orderNumber: order.number, quoteId: order.quoteId, quoteNumber: order.quote.number, customerId: order.customerId, customer: order.quote.customer, rep: order.quote.owner, status: order.state, currency: order.currency, total: Number(total.toFixed(2)), invoiced: Number(invoiced.toFixed(2)), paid: Number(paid.toFixed(2)), outstanding: Number((invoiced - paid).toFixed(2)), createdAt: order.createdAt, products: lines.map((line) => line.productId) };
  });
  const totalsByCurrency = Object.fromEntries([...new Set(rows.map((row) => row.currency))].map((currency) => {
    const group = rows.filter((row) => row.currency === currency);
    return [currency, { sales: Number(group.reduce((sum, row) => sum + row.total, 0).toFixed(2)), invoiced: Number(group.reduce((sum, row) => sum + row.invoiced, 0).toFixed(2)), paid: Number(group.reduce((sum, row) => sum + row.paid, 0).toFixed(2)), outstanding: Number(group.reduce((sum, row) => sum + row.outstanding, 0).toFixed(2)) }];
  }));
  return { filters: { from: filters.from?.toISOString() ?? null, to: filters.to?.toISOString() ?? null, repId: filters.repId ?? null, status: filters.status ?? null, productId: filters.productId ?? null }, count: rows.length, totalsByCurrency, rows };
}

const spreadsheetText = (value: unknown) => /^[=+\-@]/.test(String(value ?? '')) ? `'${String(value)}` : String(value ?? '');

export async function reportAsXls(report: Awaited<ReturnType<typeof aggregateSales>>) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DealOS';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Sales');
  sheet.columns = [
    {header:'Order',key:'order',width:18},{header:'Quotation',key:'quote',width:18},{header:'Customer',key:'customer',width:28},
    {header:'Representative',key:'representative',width:24},{header:'Status',key:'status',width:20},{header:'Currency',key:'currency',width:10},
    {header:'Sales',key:'sales',width:14},{header:'Invoiced',key:'invoiced',width:14},{header:'Paid',key:'paid',width:14},{header:'Outstanding',key:'outstanding',width:14},{header:'Confirmed at',key:'confirmedAt',width:24},
  ];
  for(const row of report.rows)sheet.addRow({order:spreadsheetText(row.orderNumber),quote:spreadsheetText(row.quoteNumber),customer:spreadsheetText(row.customer),representative:spreadsheetText(row.rep.name),status:row.status,currency:row.currency,sales:row.total,invoiced:row.invoiced,paid:row.paid,outstanding:row.outstanding,confirmedAt:row.createdAt});
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F6B5C'}};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:K1';
  ['G','H','I','J'].forEach(column=>{sheet.getColumn(column).numFmt='#,##0.00'});sheet.getColumn('K').numFmt='yyyy-mm-dd hh:mm';
  const bytes=await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

const pdfText = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').replace(/([\\()])/g, '\\$1');
export function reportAsPdf(report: Awaited<ReturnType<typeof aggregateSales>>) {
  const pageRows = report.rows.length ? Array.from({ length: Math.ceil(report.rows.length / 32) }, (_, index) => report.rows.slice(index * 32, index * 32 + 32)) : [[]];
  const fontId = 3 + pageRows.length * 2;
  const pageIds = pageRows.map((_, index) => 3 + index * 2);
  const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageRows.length} >>`];
  pageRows.forEach((rows, pageIndex) => {
    const pageId = pageIds[pageIndex]!;
    const contentId = pageId + 1;
    const commands = ['BT /F1 18 Tf 45 770 Td', '(DealOS Sales Report) Tj', '0 -24 Td /F1 9 Tf', `(Confirmed orders: ${report.count} | Page ${pageIndex + 1} of ${pageRows.length}) Tj`, '0 -24 Td'];
    for (const row of rows) commands.push(`(${pdfText(`${row.orderNumber} | ${row.customer} | ${row.rep.name} | ${row.currency} ${row.total.toFixed(2)} | ${row.status}`)}) Tj`, '0 -16 Td');
    commands.push('ET');
    const stream = commands.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output); output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
