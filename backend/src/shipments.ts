import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export class ShipmentError extends Error {
  constructor(readonly status:number, readonly code:string, message:string){super(message)}
}

export const shipOrderSchema=z.object({
  lines:z.array(z.object({orderLineId:z.string().uuid(),quantity:z.number().int().positive()}).strict()).min(1).max(200),
  carrier:z.string().trim().min(2).max(120),
  trackingNumber:z.string().trim().min(2).max(160),
  shippedAt:z.string().datetime().optional(),
}).strict();

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const decimal=(value:unknown)=>new Prisma.Decimal(String(value??0));
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const addDays=(value:Date,days:number)=>new Date(value.getTime()+days*86_400_000);
const requestHash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const replayBody=(value:Prisma.JsonValue)=>record(value) as {shipment:Prisma.JsonValue;invoice:Prisma.JsonValue;orderState:string};

export async function shipOrder(tx:Prisma.TransactionClient,input:{organizationId:string;actorId:string;orderId:string;lines:Array<{orderLineId:string;quantity:number}>;carrier:string;trackingNumber:string;shippedAt:Date;idempotencyKey:string;requestId?:string}){
  const operation='SHIP_ORDER';
  const fingerprint=requestHash({lines:[...input.lines].sort((a,b)=>a.orderLineId.localeCompare(b.orderLineId)),carrier:input.carrier,trackingNumber:input.trackingNumber,shippedAt:input.shippedAt.toISOString()});
  const key={actorId_operation_resourceKey_key:{actorId:input.actorId,operation,resourceKey:input.orderId,key:input.idempotencyKey}};
  const replay=await tx.idempotencyRecord.findUnique({where:key});
  if(replay){
    if(replay.payloadHash!==fingerprint)throw new ShipmentError(409,'IDEMPOTENCY_CONFLICT','This idempotency key was already used for a different shipment.');
    return {...replayBody(replay.responseBody),replayed:true};
  }
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const lockedReplay=await tx.idempotencyRecord.findUnique({where:key});
  if(lockedReplay){
    if(lockedReplay.payloadHash!==fingerprint)throw new ShipmentError(409,'IDEMPOTENCY_CONFLICT','This idempotency key was already used for a different shipment.');
    return {...replayBody(lockedReplay.responseBody),replayed:true};
  }
  const order=await tx.order.findFirst({where:{id:input.orderId,quote:{is:{organizationId:input.organizationId}}},include:{customer:true,quote:true,fulfillment:true,lines:{include:{reservations:true,shipmentLines:{include:{shipment:true}}}},shipments:{include:{lines:true}}}});
  if(!order)throw new ShipmentError(404,'NOT_FOUND','Allocated order not found.');
  if(!order.fulfillment||!['ALLOCATED','PARTIALLY_ALLOCATED','BACKORDER','PARTIALLY_SHIPPED'].includes(order.state))throw new ShipmentError(409,'INVALID_STATE','Reserve stock before creating a shipment.');
  const requested=new Map(input.lines.map(line=>[line.orderLineId,line.quantity]));
  if(requested.size!==input.lines.length)throw new ShipmentError(422,'VALIDATION_ERROR','Each order line may appear only once per shipment.');
  const shipmentLines:Array<{orderLineId:string;quantity:number;snapshot:Record<string,unknown>;productId:string;unitAmount:Prisma.Decimal}>=[];
  for(const line of order.lines){
    const quantity=requested.get(line.id);
    if(!quantity)continue;
    if(line.recurring)throw new ShipmentError(422,'RECURRING_NOT_SHIPPABLE','Recurring lines are billed by period and cannot be shipped.');
    const reserved=line.reservations.reduce((sum,row)=>sum+row.quantity,0);
    const shipped=line.shipmentLines.filter(row=>row.shipment.state==='SHIPPED').reduce((sum,row)=>sum+row.quantity,0);
    if(quantity>reserved-shipped)throw new ShipmentError(422,'QUANTITY_EXCEEDS_ALLOCATION','Shipment quantity exceeds the unshipped reserved quantity.');
    const snapshot=record(line.snapshot);
    const sourceQty=Math.max(1,Number(snapshot.quantity??line.quantity));
    shipmentLines.push({orderLineId:line.id,quantity,snapshot,productId:line.productId,unitAmount:decimal(snapshot.net).add(decimal(snapshot.tax)).div(sourceQty)});
  }
  if(shipmentLines.length!==requested.size)throw new ShipmentError(422,'VALIDATION_ERROR','One or more shipment lines are unavailable.');
  const shipment=await tx.shipment.create({data:{organizationId:input.organizationId,orderId:order.id,number:`SHP-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,state:'SHIPPED',carrier:input.carrier,trackingNumber:input.trackingNumber,shippedAt:input.shippedAt,lines:{create:shipmentLines.map(line=>({orderLineId:line.orderLineId,quantity:line.quantity}))}}});
  for(const shipped of shipmentLines){
    let remaining=shipped.quantity;
    const source=order.lines.find(line=>line.id===shipped.orderLineId)!;
    for(const reservation of source.reservations){
      if(remaining<=0)break;
      const take=Math.min(remaining,reservation.quantity);
      const balance=await tx.stockBalance.findUniqueOrThrow({where:{id:reservation.stockBalanceId}});
      if(balance.onHand<take||balance.reserved<take)throw new ShipmentError(409,'STOCK_CHANGED','Reserved stock changed before dispatch.');
      await tx.stockBalance.update({where:{id:balance.id},data:{onHand:{decrement:take},reserved:{decrement:take}}});
      await tx.stockMovement.create({data:{organizationId:input.organizationId,stockBalanceId:balance.id,orderId:order.id,productId:shipped.productId,kind:'SHIPMENT',quantityDelta:-take,reference:shipment.number,reason:`Dispatched via ${input.carrier} (${input.trackingNumber})`,actorId:input.actorId}});
      remaining-=take;
    }
  }
  const invoiceLines=shipmentLines.map(line=>{const sourceQty=Math.max(1,Number(line.snapshot.quantity??1));const net=decimal(line.snapshot.net).div(sourceQty).mul(line.quantity).toDecimalPlaces(2);const tax=decimal(line.snapshot.tax).div(sourceQty).mul(line.quantity).toDecimalPlaces(2);return{description:String(line.snapshot.description??line.snapshot.name??'Shipped item'),productId:line.productId,cadence:'One-time',quantity:line.quantity,unitPrice:decimal(line.snapshot.unitPrice).toNumber(),discount:decimal(line.snapshot.discount).toNumber(),net:net.toNumber(),tax:tax.toNumber(),amount:net.add(tax).toNumber(),shipmentNumber:shipment.number}});
  const amount=invoiceLines.reduce((sum,line)=>sum.add(line.amount),decimal(0)).toDecimalPlaces(2);
  const invoice=await tx.invoice.create({data:{organizationId:input.organizationId,number:`INV-${shipment.number.replace(/^SHP-/,'')}`,billingKey:`SHIPMENT:${shipment.id}`,quoteId:order.quoteId,orderId:order.id,shipmentId:shipment.id,customerId:order.customerId,customer:order.customer.name,currency:order.currency,amount,dueAt:addDays(input.shippedAt,order.customer.paymentTerms),lines:json(invoiceLines)}});
  const allHardware=order.lines.filter(line=>!line.recurring);
  const shippedTotals=await tx.shipmentLine.groupBy({by:['orderLineId'],where:{orderLineId:{in:allHardware.map(line=>line.id)},shipment:{state:'SHIPPED'}},_sum:{quantity:true}});
  const complete=allHardware.every(line=>(shippedTotals.find(row=>row.orderLineId===line.id)?._sum.quantity??0)>=line.quantity);
  await tx.order.update({where:{id:order.id},data:{state:complete?'SHIPPED':'PARTIALLY_SHIPPED'}});
  await tx.auditEvent.create({data:{organizationId:input.organizationId,actorId:input.actorId,action:'ORDER_SHIPPED_AND_INVOICED',resource:'Shipment',resourceId:shipment.id,revisionId:order.revisionId,requestId:input.requestId,reason:`${shipment.number}; ${input.carrier}; ${input.trackingNumber}; invoice ${invoice.number}`}});
  const body={shipment,invoice,orderState:complete?'SHIPPED':'PARTIALLY_SHIPPED'};
  await tx.idempotencyRecord.create({data:{actorId:input.actorId,operation,resourceKey:input.orderId,key:input.idempotencyKey,payloadHash:fingerprint,responseStatus:201,responseBody:json(body)}});
  return {...body,replayed:false};
}
