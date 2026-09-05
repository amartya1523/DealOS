export type Workspace = {
  user: { id: string; name: string; email: string; loginId?: string; role: string; customerId?:string|null; moduleAccess: string[]; actorType:'USER'|'PLATFORM_OWNER'; platformSuperAdmin:boolean; viewContext:{readOnly:true;organizationId:string;organizationName:string;simulatedUserId:string|null;realActor:{id:string;name:string}}|null };
  organization: { id: string; name: string };
  users: Array<{ id:string; name:string; email:string; loginId?:string; role:string; status:string; moduleAccess:string[]; createdAt:string }>;
  customers: Customer[];
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
export type Customer = { id:string; name:string; tier:string; currency:string; customerType:string; region:string; contactPerson?:string|null; email?:string|null; phone?:string|null; countryCode:string; gstin?:string|null; billingAddress?:string|null; shippingAddress?:string|null; paymentTerms:number; active:boolean; createdAt:string; updatedAt:string; quotes?:Array<{id:string;number:string;stage:string;total:number|string;updatedAt:string}>; invoices?:Array<{id:string;number:string;state:string;amount:number|string;paidAmount:number|string;dueAt:string}>; users?:Array<{id:string;email:string;status:string;googleSubject?:string|null}>; invitations?:Array<{id:string;email:string;status:string;expiresAt:string;createdAt:string}> };
export type Product = { id:string;name:string;sku:string;category:string;description:string;unit:string;price:number|string;cost:number|string;taxRate:number|string;recurring:boolean;cadence?:string;active:boolean;storeVisible?:boolean;featured?:boolean;stocks:Array<{onHand:number;reserved:number;minAlertLevel?:number;maxCapacity?:number|null;warehouse:{name:string}}> };
export type Policy = {id:string;tier:string;maxDiscount:number|string;hardwareLimit:number|string;servicesLimit:number|string;subscriptionLimit:number|string;financeThreshold:number|string};
export type Warehouse = {id:string;name:string;priority:number;shippingCost:number|string;stocks:Array<{onHand:number;reserved:number;product:Product}>};
export type Subscription = {id:string;customer:string;productName:string;cadence:string;amount:number|string;nextBillAt:string;state:string;schedule?:string[]};
export type Invoice = {id:string;number:string;customer:string;customerRecord?:Pick<Customer,'id'|'email'|'phone'|'countryCode'|'contactPerson'>;amount:number|string;paidAmount:number|string;state:string;dueAt:string;lines:Array<{description:string;amount:number;productId?:string;quantity?:number;unitPrice?:number;discount?:number;tax?:number;net?:number;cadence?:string}>;payments:Array<{id:string;amount:number|string;reference:string;paidAt:string}>};
export type Alert = {id:string;kind:string;title:string;detail:string;severity:string;resourceId:string;resolved:boolean;nudged:boolean};
export type Audit = {id:string;action:string;resource:string;resourceId:string;reason?:string;createdAt:string};

let csrfToken = '';

export async function request<T>(path:string, options:RequestInit = {}):Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const mutating = !['GET','HEAD','OPTIONS'].includes(method);
  const cookieCsrf = document.cookie.split('; ').find((part)=>part.startsWith('dealos_csrf='))?.split('=').slice(1).join('=');
  const activeCsrf = cookieCsrf ? decodeURIComponent(cookieCsrf) : csrfToken;
  const response = await fetch(`/api/v1${path}`, { ...options, credentials:'include', headers:{'Content-Type':'application/json', ...(mutating && activeCsrf ? {'X-CSRF-Token':activeCsrf} : {}), ...(mutating && !options.headers ? {'Idempotency-Key':crypto.randomUUID()} : {}), ...(options.headers ?? {})} });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.error?.message ?? 'Request failed');
  if (body.data?.csrfToken) csrfToken = body.data.csrfToken;
  if (body.data?.user?.csrfToken) csrfToken = body.data.user.csrfToken;
  if (path==='/auth/logout') csrfToken = '';
  return body.data as T;
}
