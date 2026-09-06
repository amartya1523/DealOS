import {describe,expect,it,vi} from 'vitest';
import {shipOrder,ShipmentError} from '../src/shipments.js';

const orderFixture=()=>({
  id:'order-1',quoteId:'quote-1',revisionId:'revision-1',customerId:'customer-1',currency:'INR',state:'ALLOCATED',
  customer:{name:'Acme',paymentTerms:15},quote:{organizationId:'org-1'},fulfillment:{id:'fulfillment-1'},shipments:[],
  lines:[{id:'line-1',productId:'product-1',quantity:2,recurring:false,snapshot:{name:'Laptop',quantity:2,unitPrice:'100',discount:0,net:200,tax:36},reservations:[{id:'reservation-1',quantity:2,stockBalanceId:'balance-1'}],shipmentLines:[]}],
});

describe('shipment-driven invoicing',()=>{
  it('consumes allocated stock, records dispatch, and invoices only shipped quantity',async()=>{
    const stockUpdate=vi.fn(async()=>({}));const invoiceCreate=vi.fn(async({data}:any)=>({id:'invoice-1',...data}));
    const tx:any={$queryRaw:vi.fn(async()=>[]),idempotencyRecord:{findUnique:vi.fn(async()=>null),create:vi.fn(async()=>({}))},order:{findFirst:vi.fn(async()=>orderFixture()),update:vi.fn(async()=>({}))},shipment:{create:vi.fn(async({data}:any)=>({id:'shipment-1',number:'SHP-1',...data}))},stockBalance:{findUniqueOrThrow:vi.fn(async()=>({id:'balance-1',onHand:5,reserved:2})),update:stockUpdate},stockMovement:{create:vi.fn(async()=>({}))},invoice:{create:invoiceCreate},shipmentLine:{groupBy:vi.fn(async()=>[{orderLineId:'line-1',_sum:{quantity:1}}])},auditEvent:{create:vi.fn(async()=>({}))}};
    const result=await shipOrder(tx,{organizationId:'org-1',actorId:'finance-1',orderId:'order-1',lines:[{orderLineId:'line-1',quantity:1}],carrier:'Blue Dart',trackingNumber:'AWB-1',shippedAt:new Date('2026-09-06T10:00:00Z'),idempotencyKey:'shipment-test-key-0001'});
    expect(result.orderState).toBe('PARTIALLY_SHIPPED');
    expect(stockUpdate).toHaveBeenCalledWith({where:{id:'balance-1'},data:{onHand:{decrement:1},reserved:{decrement:1}}});
    expect(invoiceCreate.mock.calls[0]![0].data).toMatchObject({shipmentId:'shipment-1',dueAt:new Date('2026-09-21T10:00:00Z')});
    expect(invoiceCreate.mock.calls[0]![0].data.amount.toString()).toBe('118');
    expect(invoiceCreate.mock.calls[0]![0].data.lines[0]).toMatchObject({quantity:1,net:100,tax:18,amount:118});
  });

  it('rejects quantities beyond the remaining allocation',async()=>{
    const order=orderFixture();order.lines[0]!.shipmentLines=[{shipment:{state:'SHIPPED'},quantity:1}] as never;
    const tx:any={$queryRaw:vi.fn(async()=>[]),idempotencyRecord:{findUnique:vi.fn(async()=>null)},order:{findFirst:vi.fn(async()=>order)}};
    await expect(shipOrder(tx,{organizationId:'org-1',actorId:'finance-1',orderId:'order-1',lines:[{orderLineId:'line-1',quantity:2}],carrier:'Blue Dart',trackingNumber:'AWB-2',shippedAt:new Date(),idempotencyKey:'shipment-test-key-0002'})).rejects.toBeInstanceOf(ShipmentError);
  });

  it('replays an identical shipment idempotently without another stock write',async()=>{
    const shippedAt=new Date('2026-09-06T10:00:00Z');
    const payload={lines:[{orderLineId:'line-1',quantity:1}],carrier:'Blue Dart',trackingNumber:'AWB-3',shippedAt:shippedAt.toISOString()};
    const crypto=await import('node:crypto');
    const tx:any={
      $queryRaw:vi.fn(),
      idempotencyRecord:{findUnique:vi.fn(async()=>({
        payloadHash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        responseBody:{shipment:{id:'shipment-1'},invoice:{id:'invoice-1'},orderState:'PARTIALLY_SHIPPED'},
      }))},
    };
    const result=await shipOrder(tx,{organizationId:'org-1',actorId:'finance-1',orderId:'order-1',lines:payload.lines,carrier:payload.carrier,trackingNumber:payload.trackingNumber,shippedAt,idempotencyKey:'shipment-test-key-0003'});
    expect(result).toMatchObject({replayed:true,orderState:'PARTIALLY_SHIPPED'});
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
