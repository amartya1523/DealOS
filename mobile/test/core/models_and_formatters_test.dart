import 'package:dealos_mobile/core/utils/formatters.dart';
import 'package:dealos_mobile/features/workspace/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

import '../fixtures.dart';

void main() {
  test('deserializes decimal strings without binary contract assumptions', () {
    final workspace = fixtureWorkspace();
    expect(workspace.quotes.single.total, 147500);
    expect(workspace.quotes.single.lines.single.unitCost, 82000);
    expect(workspace.invoices.single.outstanding, 147500);
    expect(workspace.user.hasModule('approvals'), isTrue);
  });

  test('customer role never gains an internal module implicitly', () {
    final workspace = fixtureWorkspace(role: 'CUSTOMER', modules: const []);
    expect(workspace.user.isCustomer, isTrue);
    expect(workspace.user.hasModule('products'), isFalse);
    expect(workspace.user.hasRole('FINANCE'), isFalse);
  });

  test('approval keeps the decision actor separate from the required step', () {
    final approval = Approval.fromJson(const {
      'id': 'approval-1',
      'step': 'Sales Manager',
      'sequence': 1,
      'state': 'REJECTED',
      'reason': 'Pricing exception',
      'reviewerId': 'admin-1',
      'reviewer': {'id': 'admin-1', 'name': 'Asha Admin', 'role': 'ADMIN'},
    });

    expect(approval.step, 'Sales Manager');
    expect(approval.reviewerId, 'admin-1');
    expect(approval.decisionSummary, 'Rejected by Asha Admin (Admin)');
  });

  test('formatters handle strings, numbers and invalid dates safely', () {
    expect(asDouble('12.50'), 12.5);
    expect(asInt('4'), 4);
    expect(label('PENDING_APPROVAL'), 'Pending Approval');
    expect(shortDate('invalid'), '—');
  });
}
