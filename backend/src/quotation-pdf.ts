import PDFDocument from 'pdfkit';

export type CustomerQuotationPreview = {
  organization: { name: string };
  quotation: {
    number: string;
    customer: string;
    customerTier: string;
    revisionNumber: number;
    state: string;
    currency: string;
    validUntil: string | null;
    promisedDeliveryAt: string | null;
    terms: string | null;
    subtotal: string;
    taxTotal: string;
    total: string;
    sentAt: string | null;
  };
  lines: Array<{ name: string; sku: string; description: string; quantity: number; unitPrice: string; discount: string; net: string; cadence: string | null }>;
};

const ink = '#171713';
const muted = '#706b62';
const accent = '#ff4f1f';
const gold = '#ffbd0a';
const rule = '#d9d3c8';

function amount(value:string,currency:string) {
  return `${currency} ${new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value))}`;
}

function formattedDate(value:string|null) {
  return value ? new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : 'Not specified';
}

export function renderQuotationPdf(preview:CustomerQuotationPreview):Promise<Buffer> {
  return new Promise((resolve,reject)=>{
    const document=new PDFDocument({size:'A4',margin:48,bufferPages:true,info:{Title:`Quotation ${preview.quotation.number}`,Author:preview.organization.name,Subject:'Customer quotation'}});
    const chunks:Buffer[]=[];
    document.on('data',(chunk:Buffer)=>chunks.push(chunk)); document.on('end',()=>resolve(Buffer.concat(chunks))); document.on('error',reject);
    const pageWidth=document.page.width-document.page.margins.left-document.page.margins.right;
    const footer=()=>{document.save().strokeColor(rule).moveTo(48,758).lineTo(547,758).stroke().fontSize(8).fillColor(muted).text(`${preview.organization.name} | ${preview.quotation.number} | Revision ${preview.quotation.revisionNumber}`,48,768,{width:499,align:'center',lineBreak:false}).restore()};
    const ensure=(height:number)=>{if(document.y+height>735){document.addPage();document.y=48;}};

    document.rect(0,0,document.page.width,12).fill(accent);
    document.fillColor(ink).font('Helvetica-Bold').fontSize(22).text(preview.organization.name,48,42);
    document.fillColor(muted).font('Helvetica').fontSize(9).text('CUSTOMER QUOTATION',48,72,{characterSpacing:1.5});
    document.fillColor(ink).font('Helvetica-Bold').fontSize(29).text(preview.quotation.number,48,94);
    document.roundedRect(405,49,142,43,3).fill(gold);
    document.fillColor(ink).font('Helvetica-Bold').fontSize(10).text(preview.quotation.state.replaceAll('_',' '),417,65,{width:118,align:'center'});

    document.y=146;
    const infoTop=document.y;
    document.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('PREPARED FOR',48,infoTop,{characterSpacing:1});
    document.fillColor(ink).fontSize(14).text(preview.quotation.customer,48,infoTop+17);
    document.fillColor(muted).font('Helvetica').fontSize(9).text(`${preview.quotation.customerTier} customer`,48,infoTop+38);
    document.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('VALID UNTIL',300,infoTop,{characterSpacing:1});
    document.fillColor(ink).font('Helvetica').fontSize(10).text(formattedDate(preview.quotation.validUntil),300,infoTop+17);
    document.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('PROMISED DELIVERY',420,infoTop,{characterSpacing:1});
    document.fillColor(ink).font('Helvetica').fontSize(10).text(formattedDate(preview.quotation.promisedDeliveryAt),420,infoTop+17,{width:127});
    document.y=220;

    const widths=[205,45,82,62,105];
    const headers=['PRODUCT','QTY','UNIT PRICE','DISCOUNT','NET'];
    const headerY=document.y;
    document.rect(48,headerY,pageWidth,28).fill(ink);
    let x=48; headers.forEach((header,index)=>{document.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(header,x+7,headerY+10,{width:widths[index]!-14,align:index>0?'right':'left'});x+=widths[index]!});
    document.y=headerY+28;
    for(const line of preview.lines){
      ensure(60); const y=document.y; const rowHeight=58; document.rect(48,y,pageWidth,rowHeight).fillAndStroke('#fffdf8',rule);
      document.fillColor(ink).font('Helvetica-Bold').fontSize(10).text(line.name,55,y+10,{width:190});
      document.fillColor(muted).font('Helvetica').fontSize(8).text(`${line.sku}${line.cadence?` | ${line.cadence}`:''}`,55,y+27,{width:190});
      document.text(String(line.quantity),253,y+18,{width:31,align:'right'});
      document.text(amount(line.unitPrice,preview.quotation.currency),290,y+18,{width:68,align:'right'});
      document.text(`${Number(line.discount).toFixed(2)}%`,367,y+18,{width:48,align:'right'});
      document.fillColor(ink).font('Helvetica-Bold').text(amount(line.net,preview.quotation.currency),422,y+18,{width:118,align:'right'});
      document.y=y+rowHeight;
    }

    ensure(125); document.y+=18; const totalsX=340; const totalWidth=207;
    const totalRow=(label:string,value:string,bold=false)=>{const y=document.y;document.fillColor(muted).font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?11:9).text(label,totalsX,y,{width:75});document.fillColor(ink).font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?13:10).text(amount(value,preview.quotation.currency),totalsX+78,y,{width:129,align:'right'});document.y=y+(bold?27:20)};
    totalRow('Subtotal',preview.quotation.subtotal); totalRow('Tax',preview.quotation.taxTotal); document.strokeColor(rule).moveTo(totalsX,document.y).lineTo(totalsX+totalWidth,document.y).stroke();document.y+=10;totalRow('Total',preview.quotation.total,true);

    if(preview.quotation.terms){ensure(90);document.y+=16;document.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('COMMERCIAL TERMS',48,document.y,{characterSpacing:1});document.y+=15;document.fillColor(ink).font('Helvetica').fontSize(9).text(preview.quotation.terms,48,document.y,{width:pageWidth,lineGap:3});}
    ensure(70);document.y+=24;document.rect(48,document.y,pageWidth,45).fill('#f1eee6');document.fillColor(muted).font('Helvetica').fontSize(8).text('This document is a customer-safe representation of the governed quotation revision. Acceptance and fulfillment remain subject to the status shown in the DealOS customer portal.',60,document.y+12,{width:pageWidth-24,lineGap:2});

    const pages=document.bufferedPageRange(); for(let index=0;index<pages.count;index++){document.switchToPage(index);footer();document.fillColor(muted).font('Helvetica').fontSize(8).text(`Page ${index+1} of ${pages.count}`,475,768,{width:72,align:'right',lineBreak:false});} document.end();
  });
}
