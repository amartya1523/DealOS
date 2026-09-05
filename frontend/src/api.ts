export type Workspace = {
  user: { id: string; realUserId:string; actorType:'USER'|'PLATFORM_OWNER'; name: string; email: string; role: string; platformSuperAdmin:boolean; organization:{id:string;name:string;status:string}|null; viewContext:{readOnly:true;organizationId:string;organizationName:string;simulatedUserId:string|null;realActor:{id:string;name:string}}|null };
  quotes: Quote[];
  products: Product[];
  policies: Policy[];
  warehouses: Warehouse[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  alerts: Alert[];
  audits: Audit[];
};

export type Quote = { id:string; number:string; customer:string; customerTier:string; stage:string; version:number; orderDiscount:number|string; total:number|string; margin:number|string; riskScore:number|string; updatedAt:string; lines: Array<{id:string;productId:string;quantity:number;unitPrice:number|string;unitCost:number|string;discount:number|string;allowedDiscount:number|string;product:Product}>; approvals:Array<{id:string;step:string;sequence:number;state:string;reason?:string}>; fulfillment?:{state:string;split:{split:Array<{warehouseName:string;quantity:number;productId:string}>;backorders:Array<{productId:string;quantity:number}>};estimatedCost:number|string;shipmentCount:number}; negotiation:Array<{id:string;author:string;message:string;counterDiscount?:number|string;createdAt:string}>; invoices:Array<{id:string;number:string;state:string}> };
export type Product = { id:string;name:string;sku:string;category:string;description:string;unit:string;price:number|string;cost:number|string;taxRate:number|string;recurring:boolean;cadence?:string;active:boolean;stocks:Array<{onHand:number;reserved:number;warehouse:{name:string}}> };
export type Policy = {id:string;tier:string;maxDiscount:number|string;hardwareLimit:number|string;servicesLimit:number|string;subscriptionLimit:number|string;financeThreshold:number|string};
export type Warehouse = {id:string;name:string;priority:number;shippingCost:number|string;stocks:Array<{onHand:number;reserved:number;product:Product}>};
export type Subscription = {id:string;customer:string;productName:string;cadence:string;amount:number|string;nextBillAt:string;state:string};
export type Invoice = {id:string;number:string;customer:string;amount:number|string;paidAmount:number|string;state:string;dueAt:string;lines:Array<{description:string;amount:number}>;payments:Array<{id:string;amount:number|string;reference:string;paidAt:string}>};
export type Alert = {id:string;kind:string;title:string;detail:string;severity:string;resourceId:string;resolved:boolean;nudged:boolean};
export type Audit = {id:string;action:string;resource:string;resourceId:string;reason?:string;createdAt:string};

export async function request<T>(path:string, options:RequestInit = {}):Promise<T> {
  const csrf = document.cookie.split('; ').find((part)=>part.startsWith('dealos_csrf='))?.split('=').slice(1).join('=');
  const mutation = Boolean(options.method && !['GET','HEAD'].includes(options.method.toUpperCase()));
  const response = await fetch(`/api/v1${path}`, { ...options, credentials:'include', headers:{'Content-Type':'application/json', ...(csrf&&mutation?{'X-CSRF-Token':decodeURIComponent(csrf)}:{}), ...(options.headers ?? {})} });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error?.message ?? 'Request failed');
  return body.data as T;
}
