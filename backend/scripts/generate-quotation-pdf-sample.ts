import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderQuotationPdf, type CustomerQuotationPreview } from '../src/quotation-pdf.js';

const preview:CustomerQuotationPreview={
  organization:{name:'DealOS Demo'},
  quotation:{number:'Q-0103',customer:'Beta Industries',customerTier:'Silver',revisionNumber:3,state:'PENDING_APPROVAL',currency:'INR',validUntil:'2026-10-05T00:00:00.000Z',promisedDeliveryAt:'2026-09-25T00:00:00.000Z',terms:'Net 30. Delivery dates are confirmed after customer acceptance and stock reservation.',subtotal:'1557.00',taxTotal:'280.26',total:'1837.26',sentAt:null},
  lines:[
    {name:'Care Plan',sku:'SUB-CARE',description:'Priority support and device monitoring.',quantity:1,unitPrice:'40.00',discount:'7.00',net:'37.20',cadence:'Monthly'},
    {name:'Latitude Pro 14',sku:'HW-LP14',description:'Business laptop with three-year support.',quantity:1,unitPrice:'1200.00',discount:'5.00',net:'1140.00',cadence:null},
    {name:'Onsite Setup Service',sku:'SV-SETUP',description:'Deployment, migration and onboarding.',quantity:1,unitPrice:'400.00',discount:'5.00',net:'380.00',cadence:null},
  ],
};

const outputDirectory=path.resolve(process.cwd(),'..','output','pdf');
await mkdir(outputDirectory,{recursive:true});
await writeFile(path.join(outputDirectory,'dealos-quotation-preview.pdf'),await renderQuotationPdf(preview));
