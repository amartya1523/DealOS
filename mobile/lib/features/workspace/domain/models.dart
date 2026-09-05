import '../../../core/api/api_client.dart';
import '../../../core/utils/formatters.dart';

List<JsonMap> _maps(Object? value) => value is List
    ? value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false)
    : const [];

String _string(JsonMap json, String key, [String fallback = '']) =>
    json[key]?.toString() ?? fallback;

class Actor {
  const Actor({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    required this.moduleAccess,
    required this.actorType,
    required this.platformSuperAdmin,
    required this.readOnlyView,
    this.customerId,
    this.organizationId,
    this.csrfToken,
    this.viewContext,
  });

  final String id;
  final String name;
  final String email;
  final String role;
  final List<String> moduleAccess;
  final String actorType;
  final bool platformSuperAdmin;
  final bool readOnlyView;
  final String? customerId;
  final String? organizationId;
  final String? csrfToken;
  final ViewContext? viewContext;

  bool get isCustomer => role == 'CUSTOMER';
  bool get isPlatformOwner =>
      actorType == 'PLATFORM_OWNER' || platformSuperAdmin;
  bool hasRole(String value) => role == value || role == 'ADMIN';
  bool hasModule(String value) =>
      role == 'ADMIN' || moduleAccess.contains(value);

  factory Actor.fromJson(JsonMap json) => Actor(
    id: _string(json, 'id'),
    name: _string(json, 'name', _string(json, 'displayName', 'DealOS user')),
    email: _string(json, 'email'),
    role: _string(json, 'role'),
    moduleAccess: (json['moduleAccess'] as List? ?? const [])
        .map((item) => '$item')
        .toList(growable: false),
    actorType: _string(json, 'actorType', 'USER'),
    platformSuperAdmin: json['platformSuperAdmin'] == true,
    readOnlyView: json['readOnlyView'] == true || json['viewContext'] is Map,
    customerId: json['customerId']?.toString(),
    organizationId: json['organizationId']?.toString(),
    csrfToken: json['csrfToken']?.toString(),
    viewContext: json['viewContext'] is Map
        ? ViewContext.fromJson(
            Map<String, dynamic>.from(json['viewContext'] as Map),
          )
        : null,
  );
}

class ViewContext {
  const ViewContext({
    required this.organizationId,
    required this.organizationName,
    this.simulatedUserId,
  });
  final String organizationId;
  final String organizationName;
  final String? simulatedUserId;

  factory ViewContext.fromJson(JsonMap json) => ViewContext(
    organizationId: _string(json, 'organizationId'),
    organizationName: _string(json, 'organizationName'),
    simulatedUserId: json['simulatedUserId']?.toString(),
  );
}

class OrganizationSummary {
  const OrganizationSummary({
    required this.id,
    required this.name,
    this.status = 'ACTIVE',
  });
  final String id;
  final String name;
  final String status;

  factory OrganizationSummary.fromJson(JsonMap json) => OrganizationSummary(
    id: _string(json, 'id'),
    name: _string(json, 'name'),
    status: _string(json, 'status', 'ACTIVE'),
  );
}

class UserSummary {
  const UserSummary({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    required this.status,
    required this.moduleAccess,
    this.version = 1,
  });
  final String id;
  final String name;
  final String email;
  final String role;
  final String status;
  final List<String> moduleAccess;
  final int version;

  factory UserSummary.fromJson(JsonMap json) => UserSummary(
    id: _string(json, 'id'),
    name: _string(json, 'name'),
    email: _string(json, 'email'),
    role: _string(json, 'role', _string(json, 'businessRole')),
    status: _string(json, 'membershipStatus', _string(json, 'status')),
    moduleAccess: (json['moduleAccess'] as List? ?? const [])
        .map((item) => '$item')
        .toList(growable: false),
    version: asInt(json['version']).clamp(1, 1 << 31),
  );
}

class Customer {
  const Customer({
    required this.id,
    required this.name,
    required this.tier,
    required this.currency,
    required this.active,
    this.email,
    this.phone,
    this.contactPerson,
    this.billingAddress,
    this.shippingAddress,
    this.paymentTerms = 0,
    this.raw = const {},
  });
  final String id;
  final String name;
  final String tier;
  final String currency;
  final bool active;
  final String? email;
  final String? phone;
  final String? contactPerson;
  final String? billingAddress;
  final String? shippingAddress;
  final int paymentTerms;
  final JsonMap raw;

  factory Customer.fromJson(JsonMap json) => Customer(
    id: _string(json, 'id'),
    name: _string(json, 'name'),
    tier: _string(json, 'tier'),
    currency: _string(json, 'currency', 'INR'),
    active: json['active'] != false,
    email: json['email']?.toString(),
    phone: json['phone']?.toString(),
    contactPerson: json['contactPerson']?.toString(),
    billingAddress: json['billingAddress']?.toString(),
    shippingAddress: json['shippingAddress']?.toString(),
    paymentTerms: asInt(json['paymentTerms']),
    raw: json,
  );
}

class Product {
  const Product({
    required this.id,
    required this.name,
    required this.sku,
    required this.category,
    required this.description,
    required this.unit,
    required this.price,
    required this.cost,
    required this.taxRate,
    required this.recurring,
    required this.active,
    required this.stocks,
    this.cadence,
    this.raw = const {},
  });
  final String id;
  final String name;
  final String sku;
  final String category;
  final String description;
  final String unit;
  final double price;
  final double cost;
  final double taxRate;
  final bool recurring;
  final bool active;
  final String? cadence;
  final List<ProductStock> stocks;
  final JsonMap raw;

  int get availableStock =>
      stocks.fold(0, (sum, stock) => sum + stock.onHand - stock.reserved);

  factory Product.fromJson(JsonMap json) => Product(
    id: _string(json, 'id'),
    name: _string(json, 'name'),
    sku: _string(json, 'sku'),
    category: _string(json, 'category'),
    description: _string(json, 'description'),
    unit: _string(json, 'unit'),
    price: asDouble(json['price']),
    cost: asDouble(json['cost']),
    taxRate: asDouble(json['taxRate']),
    recurring: json['recurring'] == true,
    active: json['active'] != false,
    cadence: json['cadence']?.toString(),
    stocks: _maps(
      json['stocks'],
    ).map(ProductStock.fromJson).toList(growable: false),
    raw: json,
  );
}

class ProductStock {
  const ProductStock({
    required this.onHand,
    required this.reserved,
    required this.warehouseName,
  });
  final int onHand;
  final int reserved;
  final String warehouseName;

  factory ProductStock.fromJson(JsonMap json) => ProductStock(
    onHand: asInt(json['onHand']),
    reserved: asInt(json['reserved']),
    warehouseName: json['warehouse'] is Map
        ? '${(json['warehouse'] as Map)['name'] ?? ''}'
        : '',
  );
}

class QuoteLine {
  const QuoteLine({
    required this.id,
    required this.productId,
    required this.quantity,
    required this.unitPrice,
    required this.discount,
    required this.allowedDiscount,
    required this.product,
    this.unitCost,
  });
  final String id;
  final String productId;
  final int quantity;
  final double unitPrice;
  final double? unitCost;
  final double discount;
  final double allowedDiscount;
  final Product product;

  double get net => unitPrice * quantity * (1 - discount / 100);

  factory QuoteLine.fromJson(JsonMap json) => QuoteLine(
    id: _string(json, 'id'),
    productId: _string(json, 'productId'),
    quantity: asInt(json['quantity']),
    unitPrice: asDouble(json['unitPrice']),
    unitCost: json.containsKey('unitCost') ? asDouble(json['unitCost']) : null,
    discount: asDouble(json['discount']),
    allowedDiscount: asDouble(json['allowedDiscount']),
    product: Product.fromJson(
      json['product'] is Map
          ? Map<String, dynamic>.from(json['product'] as Map)
          : <String, dynamic>{'id': json['productId']},
    ),
  );
}

class Approval {
  const Approval({
    required this.id,
    required this.step,
    required this.state,
    required this.sequence,
    this.reason,
    this.createdAt,
    this.decidedAt,
    this.reviewerId,
    this.reviewerName,
    this.reviewerRole,
  });
  final String id;
  final String step;
  final String state;
  final int sequence;
  final String? reason;
  final DateTime? createdAt;
  final DateTime? decidedAt;
  final String? reviewerId;
  final String? reviewerName;
  final String? reviewerRole;

  String? get reviewerSummary {
    final name = reviewerName?.trim();
    if (name == null || name.isEmpty) return null;
    final role = reviewerRole?.trim();
    if (role == null || role.isEmpty) return name;
    final roleLabel = role
        .toLowerCase()
        .split('_')
        .where((part) => part.isNotEmpty)
        .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
    return '$name ($roleLabel)';
  }

  String get decisionSummary => switch (state) {
    'APPROVED' => 'Approved by ${reviewerSummary ?? 'an authorized reviewer'}',
    'REJECTED' => 'Rejected by ${reviewerSummary ?? 'an authorized reviewer'}',
    'RETURNED' => 'Returned by ${reviewerSummary ?? 'an authorized reviewer'}',
    'SUPERSEDED' => 'No decision required; this step was superseded',
    _ => 'Awaiting decision',
  };

  factory Approval.fromJson(JsonMap json) => Approval(
    id: _string(json, 'id'),
    step: _string(json, 'step'),
    state: _string(json, 'state'),
    sequence: asInt(json['sequence']),
    reason: json['reason']?.toString(),
    createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
    decidedAt: DateTime.tryParse('${json['decidedAt'] ?? ''}'),
    reviewerId: json['reviewerId']?.toString(),
    reviewerName: json['reviewer'] is Map
        ? (json['reviewer'] as Map)['name']?.toString()
        : null,
    reviewerRole: json['reviewer'] is Map
        ? (json['reviewer'] as Map)['role']?.toString()
        : null,
  );
}

class NegotiationMessage {
  const NegotiationMessage({
    required this.id,
    required this.author,
    required this.message,
    required this.createdAt,
    this.counterDiscount,
    this.kind,
    this.state,
  });
  final String id;
  final String author;
  final String message;
  final DateTime? createdAt;
  final double? counterDiscount;
  final String? kind;
  final String? state;

  factory NegotiationMessage.fromJson(JsonMap json) => NegotiationMessage(
    id: _string(json, 'id'),
    author: _string(json, 'author'),
    message: _string(json, 'message'),
    createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
    counterDiscount: json['counterDiscount'] == null
        ? null
        : asDouble(json['counterDiscount']),
    kind: json['kind']?.toString(),
    state: json['state']?.toString(),
  );
}

class Quote {
  const Quote({
    required this.id,
    required this.number,
    required this.customer,
    required this.customerTier,
    required this.stage,
    required this.version,
    required this.orderDiscount,
    required this.total,
    required this.margin,
    required this.riskScore,
    required this.updatedAt,
    required this.lines,
    required this.approvals,
    required this.negotiation,
    this.ownerName,
    this.fulfillment,
    this.order,
    this.raw = const {},
  });
  final String id;
  final String number;
  final String customer;
  final String customerTier;
  final String stage;
  final int version;
  final double orderDiscount;
  final double total;
  final double margin;
  final double riskScore;
  final DateTime? updatedAt;
  final String? ownerName;
  final List<QuoteLine> lines;
  final List<Approval> approvals;
  final List<NegotiationMessage> negotiation;
  final JsonMap? fulfillment;
  final JsonMap? order;
  final JsonMap raw;

  Approval? get pendingApproval {
    for (final approval in approvals) {
      if (approval.state == 'PENDING') return approval;
    }
    return null;
  }

  factory Quote.fromJson(JsonMap json) => Quote(
    id: _string(json, 'id'),
    number: _string(json, 'number'),
    customer: _string(json, 'customer'),
    customerTier: _string(json, 'customerTier'),
    stage: _string(json, 'stage'),
    version: asInt(json['version']),
    orderDiscount: asDouble(json['orderDiscount']),
    total: asDouble(json['total']),
    margin: asDouble(json['margin']),
    riskScore: asDouble(json['riskScore']),
    updatedAt: DateTime.tryParse('${json['updatedAt'] ?? ''}'),
    ownerName: json['owner'] is Map
        ? '${(json['owner'] as Map)['name'] ?? ''}'
        : null,
    lines: _maps(json['lines']).map(QuoteLine.fromJson).toList(growable: false),
    approvals: _maps(
      json['approvals'],
    ).map(Approval.fromJson).toList(growable: false),
    negotiation: _maps(
      json['negotiation'],
    ).map(NegotiationMessage.fromJson).toList(growable: false),
    fulfillment: json['fulfillment'] is Map
        ? Map<String, dynamic>.from(json['fulfillment'] as Map)
        : null,
    order: json['order'] is Map
        ? Map<String, dynamic>.from(json['order'] as Map)
        : null,
    raw: json,
  );
}

class Policy {
  const Policy({
    required this.id,
    required this.tier,
    required this.maxDiscount,
    required this.hardwareLimit,
    required this.servicesLimit,
    required this.subscriptionLimit,
    required this.financeThreshold,
    required this.version,
  });
  final String id;
  final String tier;
  final double maxDiscount;
  final double hardwareLimit;
  final double servicesLimit;
  final double subscriptionLimit;
  final double financeThreshold;
  final int version;

  factory Policy.fromJson(JsonMap json) => Policy(
    id: _string(json, 'id'),
    tier: _string(json, 'tier'),
    maxDiscount: asDouble(json['maxDiscount']),
    hardwareLimit: asDouble(json['hardwareLimit']),
    servicesLimit: asDouble(json['servicesLimit']),
    subscriptionLimit: asDouble(json['subscriptionLimit']),
    financeThreshold: asDouble(json['financeThreshold']),
    version: asInt(json['version']),
  );
}

class WarehouseStock {
  const WarehouseStock({
    required this.onHand,
    required this.reserved,
    required this.available,
    required this.product,
  });
  final int onHand;
  final int reserved;
  final int available;
  final Product product;

  factory WarehouseStock.fromJson(JsonMap json) => WarehouseStock(
    onHand: asInt(json['onHand']),
    reserved: asInt(json['reserved']),
    available: json.containsKey('available')
        ? asInt(json['available'])
        : asInt(json['onHand']) - asInt(json['reserved']),
    product: Product.fromJson(
      json['product'] is Map
          ? Map<String, dynamic>.from(json['product'] as Map)
          : const {},
    ),
  );
}

class Warehouse {
  const Warehouse({
    required this.id,
    required this.name,
    required this.priority,
    required this.shippingCost,
    required this.active,
    required this.stocks,
  });
  final String id;
  final String name;
  final int priority;
  final double shippingCost;
  final bool active;
  final List<WarehouseStock> stocks;

  factory Warehouse.fromJson(JsonMap json) => Warehouse(
    id: _string(json, 'id'),
    name: _string(json, 'name'),
    priority: asInt(json['priority']),
    shippingCost: asDouble(json['shippingCost']),
    active: json['active'] != false,
    stocks: _maps(
      json['stocks'],
    ).map(WarehouseStock.fromJson).toList(growable: false),
  );
}

class Subscription {
  const Subscription({
    required this.id,
    required this.customer,
    required this.productName,
    required this.cadence,
    required this.amount,
    required this.state,
    required this.nextBillAt,
    required this.schedule,
  });
  final String id;
  final String customer;
  final String productName;
  final String cadence;
  final double amount;
  final String state;
  final DateTime? nextBillAt;
  final List<DateTime> schedule;

  factory Subscription.fromJson(JsonMap json) => Subscription(
    id: _string(json, 'id'),
    customer: _string(json, 'customer'),
    productName: _string(json, 'productName'),
    cadence: _string(json, 'cadence'),
    amount: asDouble(json['amount']),
    state: _string(json, 'state'),
    nextBillAt: DateTime.tryParse('${json['nextBillAt'] ?? ''}'),
    schedule: (json['schedule'] as List? ?? const [])
        .map((item) => DateTime.tryParse('$item'))
        .whereType<DateTime>()
        .toList(growable: false),
  );
}

class InvoiceLine {
  const InvoiceLine({
    required this.description,
    required this.amount,
    this.quantity,
    this.unitPrice,
    this.discount,
    this.tax,
    this.net,
    this.cadence,
    this.productId,
  });
  final String description;
  final double amount;
  final int? quantity;
  final double? unitPrice;
  final double? discount;
  final double? tax;
  final double? net;
  final String? cadence;
  final String? productId;

  factory InvoiceLine.fromJson(JsonMap json) => InvoiceLine(
    description: _string(json, 'description'),
    amount: asDouble(json['amount']),
    quantity: json['quantity'] == null ? null : asInt(json['quantity']),
    unitPrice: json['unitPrice'] == null ? null : asDouble(json['unitPrice']),
    discount: json['discount'] == null ? null : asDouble(json['discount']),
    tax: json['tax'] == null ? null : asDouble(json['tax']),
    net: json['net'] == null ? null : asDouble(json['net']),
    cadence: json['cadence']?.toString(),
    productId: json['productId']?.toString(),
  );
}

class Payment {
  const Payment({
    required this.id,
    required this.amount,
    required this.reference,
    required this.paidAt,
  });
  final String id;
  final double amount;
  final String reference;
  final DateTime? paidAt;

  factory Payment.fromJson(JsonMap json) => Payment(
    id: _string(json, 'id'),
    amount: asDouble(json['amount']),
    reference: _string(json, 'reference'),
    paidAt: DateTime.tryParse('${json['paidAt'] ?? ''}'),
  );
}

class Invoice {
  const Invoice({
    required this.id,
    required this.number,
    required this.customer,
    required this.amount,
    required this.paidAmount,
    required this.state,
    required this.dueAt,
    required this.lines,
    required this.payments,
  });
  final String id;
  final String number;
  final String customer;
  final double amount;
  final double paidAmount;
  final String state;
  final DateTime? dueAt;
  final List<InvoiceLine> lines;
  final List<Payment> payments;
  double get outstanding => amount - paidAmount;

  factory Invoice.fromJson(JsonMap json) => Invoice(
    id: _string(json, 'id'),
    number: _string(json, 'number'),
    customer: _string(json, 'customer'),
    amount: asDouble(json['amount']),
    paidAmount: asDouble(json['paidAmount']),
    state: _string(json, 'state'),
    dueAt: DateTime.tryParse('${json['dueAt'] ?? ''}'),
    lines: _maps(
      json['lines'],
    ).map(InvoiceLine.fromJson).toList(growable: false),
    payments: _maps(
      json['payments'],
    ).map(Payment.fromJson).toList(growable: false),
  );
}

class AlertItem {
  const AlertItem({
    required this.id,
    required this.kind,
    required this.title,
    required this.detail,
    required this.severity,
    required this.resourceId,
    required this.resolved,
    required this.createdAt,
  });
  final String id;
  final String kind;
  final String title;
  final String detail;
  final String severity;
  final String resourceId;
  final bool resolved;
  final DateTime? createdAt;

  factory AlertItem.fromJson(JsonMap json) => AlertItem(
    id: _string(json, 'id'),
    kind: _string(json, 'kind'),
    title: _string(json, 'title'),
    detail: _string(json, 'detail'),
    severity: _string(json, 'severity'),
    resourceId: _string(json, 'resourceId'),
    resolved: json['resolved'] == true,
    createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
  );
}

class AuditItem {
  const AuditItem({
    required this.id,
    required this.action,
    required this.resource,
    required this.resourceId,
    required this.createdAt,
    this.reason,
  });
  final String id;
  final String action;
  final String resource;
  final String resourceId;
  final String? reason;
  final DateTime? createdAt;

  factory AuditItem.fromJson(JsonMap json) => AuditItem(
    id: _string(json, 'id'),
    action: _string(json, 'action'),
    resource: _string(json, 'resource'),
    resourceId: _string(json, 'resourceId'),
    reason: json['reason']?.toString(),
    createdAt: DateTime.tryParse('${json['createdAt'] ?? ''}'),
  );
}

class Workspace {
  const Workspace({
    required this.user,
    required this.organization,
    required this.users,
    required this.customers,
    required this.quotes,
    required this.products,
    required this.policies,
    required this.warehouses,
    required this.subscriptions,
    required this.invoices,
    required this.alerts,
    required this.audits,
    required this.syncedAt,
  });

  final Actor user;
  final OrganizationSummary? organization;
  final List<UserSummary> users;
  final List<Customer> customers;
  final List<Quote> quotes;
  final List<Product> products;
  final List<Policy> policies;
  final List<Warehouse> warehouses;
  final List<Subscription> subscriptions;
  final List<Invoice> invoices;
  final List<AlertItem> alerts;
  final List<AuditItem> audits;
  final DateTime syncedAt;

  factory Workspace.fromJson(JsonMap json) => Workspace(
    user: Actor.fromJson(
      Map<String, dynamic>.from(json['user'] as Map? ?? const {}),
    ),
    organization: json['organization'] is Map
        ? OrganizationSummary.fromJson(
            Map<String, dynamic>.from(json['organization'] as Map),
          )
        : null,
    users: _maps(
      json['users'],
    ).map(UserSummary.fromJson).toList(growable: false),
    customers: _maps(
      json['customers'],
    ).map(Customer.fromJson).toList(growable: false),
    quotes: _maps(json['quotes']).map(Quote.fromJson).toList(growable: false),
    products: _maps(
      json['products'],
    ).map(Product.fromJson).toList(growable: false),
    policies: _maps(
      json['policies'],
    ).map(Policy.fromJson).toList(growable: false),
    warehouses: _maps(
      json['warehouses'],
    ).map(Warehouse.fromJson).toList(growable: false),
    subscriptions: _maps(
      json['subscriptions'],
    ).map(Subscription.fromJson).toList(growable: false),
    invoices: _maps(
      json['invoices'],
    ).map(Invoice.fromJson).toList(growable: false),
    alerts: _maps(
      json['alerts'],
    ).map(AlertItem.fromJson).toList(growable: false),
    audits: _maps(
      json['audits'],
    ).map(AuditItem.fromJson).toList(growable: false),
    syncedAt: DateTime.now(),
  );
}

class PlatformDashboard {
  const PlatformDashboard({
    required this.metrics,
    required this.organizations,
    required this.recentActions,
  });
  final JsonMap metrics;
  final List<JsonMap> organizations;
  final List<JsonMap> recentActions;

  factory PlatformDashboard.fromJson(JsonMap json) => PlatformDashboard(
    metrics: json['metrics'] is Map
        ? Map<String, dynamic>.from(json['metrics'] as Map)
        : const {},
    organizations: _maps(json['organizations']),
    recentActions: _maps(json['recentActions']),
  );
}
