export type Workspace = {
  user: { id: string; name: string; email: string; loginId?: string; role: string; customerId?:string|null; moduleAccess: string[]; actorType:'USER'|'PLATFORM_OWNER'; platformSuperAdmin:boolean; viewContext:{readOnly:true;organizationId:string;organizationName:string;simulatedUserId:string|null;realActor:{id:string;name:string}}|null };
  organization: { id: string; name: string };
  users: Array<{ id:string; name:string; email:string; loginId?:string; role:string; status:string; membershipStatus?:string; accessRole?:string; moduleAccess:string[]; createdAt:string; joinedAt?:string }>;
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

export type RiskExplanationCard = {key:string;label:string;value:string;detail:string;tone:'ok'|'warn'|'danger'|'neutral'};
export type RiskBreakdown = {
  worstExcess:number;
  weightedExcess:number;
  aggregateDiscount:number;
  riskByCadence:Record<string,{worstExcess:number;weightedExcess:number;aggregateDiscount:number;marginPercent:number}>;
  orderDiscount:number;
  marginPercent:number;
  financeThreshold:number;
  minimumMarginPercent:number;
  policyVersion:number|null;
  policyTier:string;
  managerReason:string;
  financeReason:string;
  cards:RiskExplanationCard[];
};
export type Quote = { id:string; number:string; customer:string; customerTier:string; stage:string; version:number; currentRevisionId?:string|null; revisionId?:string; revisionNumber?:number; revisionState?:string; termsHash?:string; currency?:string; validUntil?:string|null; promisedDeliveryAt?:string|null; terms?:string|null; subtotal?:number|string; taxTotal?:number|string; sentAt?:string|null; capabilities?:{comment:boolean;accept:boolean;propose:boolean}; orderDiscount:number|string; total:number|string; margin:number|string; riskScore:number|string; createdAt?:string; updatedAt:string; lastActivity?:string; riskBreakdown?:RiskBreakdown; owner?:{id:string;name:string}; order?:{id:string;number:string;state:string}; lines: Array<{id:string;productId:string;quantity:number;unitPrice:number|string;unitCost?:number|string;discount:number|string;allowedDiscount?:number|string;net?:number|string;tax?:number|string;cadence?:string|null;product:Product}>; approvals:Array<{id:string;step:string;sequence:number;state:string;reason?:string;createdAt?:string;decidedAt?:string}>; fulfillment?:{state:string;orderState?:string;version?:number;overridden?:boolean;reason?:string|null;split:{split:Array<{reservationId?:string;orderLineId?:string;warehouseId?:string;warehouseName:string;quantity:number;productId:string}>;backorders:Array<{backorderId?:string;orderLineId?:string;productId:string;productName?:string;quantity:number}>};estimatedCost:number|string;shipmentCount:number;updatedAt?:string;stockFingerprint?:string;items?:Array<{orderLineId?:string|null;productId:string;productName:string;orderedQuantity:number;reservedQuantity?:number;fulfilledQuantity:number;backorderedQuantity:number}>;consolidationAvailable?:boolean;physicalDispatchImplemented?:boolean;statusMeaning?:string}; negotiation:Array<{id:string;author:string;message:string;messageType?:string;counterDiscount?:number|string|null;requestedDeliveryAt?:string|null;kind?:string;state?:string;responseReason?:string|null;respondedAt?:string|null;createdAt:string}>; invoices:Array<{id:string;number:string;state:string}> };
export type QuoteCalculation = {
  revisionId:string;
  version:number;
  subtotal:number;
  taxTotal:number;
  total:number;
  margin:number;
  marginPercent:number;
  riskScore:number;
  worstExcess:number;
  weightedExcess:number;
  aggregateDiscount:number;
  riskByCadence:Record<string,{worstExcess:number;weightedExcess:number;aggregateDiscount:number;marginPercent:number}>;
  needsManager:boolean;
  needsFinance:boolean;
  totalsByCadence:Record<string,{subtotal:number;tax:number;total:number;margin:number}>;
  lines:Array<{
    productId:string;
    quantity:number;
    unitPrice:number|string;
    discount:number|string;
    allowedDiscount:number|string;
    gross:number;
    net:number;
    tax:number;
    effectiveDiscount:number;
    excess:number;
    cadence:string;
  }>;
};
export type Customer = { id:string; name:string; tier:string; currency:string; customerType:string; region:string; contactPerson?:string|null; email?:string|null; phone?:string|null; countryCode:string; gstin?:string|null; billingAddress?:string|null; shippingAddress?:string|null; paymentTerms:number; active:boolean; createdAt:string; updatedAt:string; primaryTeam?:{id:string;name:string}|null; primaryRepresentative?:{id:string;name:string;assignedAt:string}|null; collaborators?:Array<{id:string;name:string;assignedAt:string}>; assignmentVersion?:number; openQuotationCount?:number; lastActivity?:string; quotes?:Array<{id:string;number:string;stage:string;total:number|string;version?:number;ownerId?:string;updatedAt:string}>; invoices?:Array<{id:string;number:string;state:string;amount:number|string;paidAmount:number|string;dueAt:string}>; users?:Array<{id:string;email:string;status:string;googleSubject?:string|null}>; invitations?:Array<{id:string;email:string;status:'PENDING'|'ACCEPTED'|'EXPIRED'|'REVOKED';expiresAt:string;invitedAt:string;acceptedAt?:string|null;revokedAt?:string|null;createdAt?:string}> };
export type Product = { id:string;name:string;sku:string;category:string;description:string;unit:string;brand?:string|null;price:number|string;cost:number|string;taxRate:number|string;recurring:boolean;cadence?:string;active:boolean;storeVisible?:boolean;featured?:boolean;stocks:Array<{onHand:number;reserved:number;minAlertLevel?:number;maxCapacity?:number|null;warehouse:{name:string}}> };
export type Policy = {id:string;tier:string;maxDiscount:number|string;hardwareLimit:number|string;servicesLimit:number|string;subscriptionLimit:number|string;financeThreshold:number|string;aggregateDiscountLimit:number|string;minimumMarginPercent:number|string;version:number;publishedAt:string};
export type Warehouse = {id:string;name:string;priority:number;shippingCost:number|string;active:boolean;stocks:Array<{onHand:number;reserved:number;available:number;product:Product}>};
export type SubscriptionChange = {id:string;kind:string;previousAmount?:number|string|null;newAmount?:number|string|null;previousState:string;newState:string;effectiveAt:string;reason:string;createdAt:string};
export type Subscription = {id:string;customer:string;productName:string;cadence:string;amount:number|string;nextBillAt:string;state:string;version:number;cancelledAt?:string|null;schedule?:string[];changes?:SubscriptionChange[]};
export type InvoicePayment = {id:string;amount:number|string;reference?:string;paidAt:string;reversalOfId?:string|null;reason?:string|null;createdAt?:string};
export type Invoice = {
  id:string;
  number:string;
  customer:string;
  customerRecord?:Pick<Customer,'id'|'email'|'phone'|'countryCode'|'contactPerson'|'currency'>;
  quoteId?:string;
  quote?:{id:string;number:string;stage:string};
  orderId?:string|null;
  order?:{id:string;number:string;state:string;currency:string;fulfillment?:{state:string;shipmentCount:number;updatedAt:string}|null}|null;
  currency?:string;
  amount:number|string;
  paidAmount:number|string;
  state:string;
  dueAt:string;
  createdAt?:string;
  updatedAt?:string;
  lines:Array<{description:string;amount:number;productId?:string;quantity?:number;unitPrice?:number;discount?:number;tax?:number;net?:number;cadence?:string}>;
  payments:InvoicePayment[];
  notes?:Array<{id:string;kind:string;message:string;requestedDueAt?:string|null;createdAt:string}>;
  credits?:Array<{id:string;number:string;amount:number|string;reason:string;createdAt:string}>;
};
export type Alert = {id:string;kind:string;title:string;detail:string;severity:string;resourceId:string;resolved:boolean;nudged:boolean;acknowledgedAt?:string|null;acknowledgedById?:string|null;resolvedAt?:string|null;lastEvaluatedAt?:string|null;createdAt:string};
export type Audit = {id:string;action:string;resource:string;resourceId:string;reason?:string;createdAt:string};

export type QuotationStage = 'DRAFT'|'PENDING_APPROVAL'|'APPROVED'|'NEGOTIATION'|'CONFIRMED'|'REJECTED';
export type QuotationSummary = {
  id:string;
  number:string;
  customer:{id:string;name:string;tier:string};
  owner:{id:string;name:string};
  stage:QuotationStage;
  total:string;
  currency:string;
  riskScore:string;
  currentApprovalStep:string|null;
  currentRevisionId:string|null;
  version:number;
  lastActivityAt:string;
};
export type CustomerOption = {id:string;name:string;tier:string;currency:string;primaryTeam?:{id:string;name:string}|null;primaryRepresentative?:{id:string;name:string;assignedAt:string}|null;collaborators?:Array<{id:string;name:string;assignedAt:string}>;assignmentVersion?:number;openQuotationCount?:number;lastActivity?:string;openQuotations?:Array<{id:string;number:string;stage:string;version:number;ownerId:string;canReassign:boolean}>};
export type QuotationsResponse = {
  items:QuotationSummary[];
  pagination:{total:number;nextCursor:string|null};
  stageCounts:Record<QuotationStage,number>;
  owners:Array<{id:string;name:string}>;
  primaryStages:QuotationStage[];
};

export type QuotationCapabilities = {
  editDraft:boolean;saveDraft:boolean;submit:boolean;assign:boolean;approve:boolean;send:boolean;negotiate:boolean;previewCustomer:boolean;downloadPdf:boolean;viewCost:boolean;viewMargin:boolean;viewActivity:boolean;
  reasons:Partial<Record<'editDraft'|'saveDraft'|'submit'|'assign'|'approve'|'send'|'negotiate',string>>;
};
export type QuotationDetail = QuotationSummary & {
  team:{id:string;name:string}|null;
  createdBy?:{id:string;name:string};
  viewerAccess?:{accountRole:string;readOnlyTeamView:boolean};
  sentAt:string|null;
  orderDiscount:string;
  subtotal:string;
  taxTotal:string;
  totalsByCadence:Record<string,{subtotal:number;tax:number;total:number;margin:number}>;
  margin?:string;
  capabilities:QuotationCapabilities;
  currentRevision:{id:string;revisionNumber:number;state:string;currency:string;validUntil:string|null;promisedDeliveryAt:string|null;terms:string|null;submittedBy:{id:string;name:string}|null}|null;
  lines:Array<{id:string;productId:string;quantity:number;unitPrice:string;unitCost?:string;discount:string;allowedDiscount:string;product:{id:string;name:string;sku:string;category:string;description:string;unit:string;price:string;cost?:string;taxRate:string;recurring:boolean;cadence:string|null;active:boolean}}>;
  approval:{caseId:string|null;caseVersion:number|null;route:'NONE'|'MANAGER'|'MANAGER_FINANCE';state:string|null;explanation:string;riskBreakdown:RiskBreakdown;violations:Array<{productId:string;product:string;discount:string;limit:string;excess:number}>;currentStep:string|null;timeline:Array<{id:string;step:string;sequence:number;cycle:number;state:string;reason:string|null;reviewer:{id:string;name:string}|null;decidedAt:string|null;createdAt:string}>};
  revisions:Array<{id:string;revisionNumber:number;state:string;total:string;margin?:string;riskScore:string;createdAt:string;lines:Array<Record<string,unknown>>;comparedWithRevision:number|null;changes:Array<{kind:string;productId?:string;name:string;fields?:string[]}>}>;
  activity:Array<{id:string;action:string;reason:string|null;revisionId:string|null;actor:{id:string;name:string};createdAt:string}>;
  assignmentOptions:{teams:Array<{id:string;name:string;managerId:string|null;memberIds:string[]}>;owners:Array<{id:string;name:string;role:string}>;managers?:Array<{id:string;name:string;role:string}>;canCreateTeam?:boolean};
  catalog:Array<{id:string;name:string;sku:string;category:string;description:string;unit:string;price:string;cost?:string;taxRate:string;recurring:boolean;cadence:string|null;active:boolean}>;
  addOns?:Array<{id:string;name:string;sku:string;category:string;cadence:string;marginContribution:string;netContribution:string}>;
  negotiation:Array<{id:string;revisionId:string;author:string;message:string;messageType?:string;counterDiscount?:string|null;requestedDeliveryAt?:string|null;kind:'COMMENT'|'PROPOSAL';state:'OPEN'|'ADOPTED'|'DECLINED';responseReason?:string|null;respondedAt?:string|null;adoptedRevisionId?:string|null;createdAt:string}>;
  order:{id:string;number:string;state:string}|null;
  invoices:Array<{id:string;number:string;state:string}>;
};

export type ApprovalStepDto={id:string;name:string;sequence:number;state:string;reviewer:{id:string;name:string}|null;reason:string|null;decidedAt:string|null;createdAt:string};
export type ApprovalCaseSummary={id:string;version:number;state:'PENDING'|'RETURNED'|'APPROVED'|'REJECTED'|'SUPERSEDED';route:'NONE'|'MANAGER'|'MANAGER_FINANCE';revisionId:string;createdAt:string;completedAt:string|null;quotation:{id:string;number:string;customer:string;customerTier:string;total:string;currency:string;owner:{id:string;name:string};team:{id:string;name:string}|null};submittedBy:{id:string;name:string};currentStep:ApprovalStepDto|null;managerStep:ApprovalStepDto|null;financeStep?:ApprovalStepDto|null;risk:{components:Record<string,unknown>;flags:Array<{scope:string;code:string;message:string;productId?:string;cadence?:string;actual:number;threshold:number}>;reasons:string[];policy:Record<string,unknown>}};
export type ApprovalCaseDetail=ApprovalCaseSummary&{lines:Array<{id:string;productId:string;product:string;category:string;quantity:number;discount:string;allowedDiscount:string}>;steps:ApprovalStepDto[];audit:Array<{id:string;action:string;reason:string|null;actor:{id:string;name:string};createdAt:string}>};
export type CustomerQuotationPreview = {
  organization:{name:string};
  quotation:{number:string;customer:string;customerTier:string;revisionNumber:number;state:string;currency:string;validUntil:string|null;promisedDeliveryAt:string|null;terms:string|null;subtotal:string;taxTotal:string;total:string;sentAt:string|null};
  lines:Array<{name:string;sku:string;description:string;quantity:number;unitPrice:string;discount:string;net:string;cadence:string|null}>;
};

export class ApiError extends Error {
  constructor(message:string, readonly status:number, readonly code:string, readonly details?:unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken = '';

export async function request<T>(path:string, options:RequestInit = {}):Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const mutating = !['GET','HEAD','OPTIONS'].includes(method);
  const cookieCsrf = document.cookie.split('; ').find((part)=>part.startsWith('dealos_csrf='))?.split('=').slice(1).join('=');
  const activeCsrf = cookieCsrf ? decodeURIComponent(cookieCsrf) : csrfToken;
  const response = await fetch(`/api/v1${path}`, { ...options, credentials:'include', headers:{'Content-Type':'application/json', ...(mutating && activeCsrf ? {'X-CSRF-Token':activeCsrf} : {}), ...(mutating && !options.headers ? {'Idempotency-Key':crypto.randomUUID()} : {}), ...(options.headers ?? {})} });
  const body = await response.json();
  if (!response.ok || !body.success) throw new ApiError(body.error?.message ?? 'Request failed', response.status, body.error?.code ?? 'REQUEST_FAILED', body.error?.details);
  if (body.data?.csrfToken) csrfToken = body.data.csrfToken;
  if (body.data?.user?.csrfToken) csrfToken = body.data.user.csrfToken;
  if (path==='/auth/logout') csrfToken = '';
  return body.data as T;
}
