import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_client.dart';
import '../core/config/app_config.dart';
import '../core/security/session_store.dart';
import '../features/auth/application/session_controller.dart';
import '../features/auth/data/auth_repository.dart';
import '../features/auth/data/customer_identity_provider.dart';
import '../features/workspace/data/workspace_cache.dart';
import '../features/workspace/data/workspace_repository.dart';

final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);
final sessionStoreProvider = Provider<SessionStore>(
  (ref) => SecureSessionStore(),
);
final workspaceCacheProvider = Provider<WorkspaceCache>(
  (ref) => SecureWorkspaceCache(),
);
final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(
    config: ref.watch(appConfigProvider),
    sessionStore: ref.watch(sessionStoreProvider),
  ),
);
final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider)),
);
final customerIdentityProvider = Provider<CustomerIdentityProvider>(
  (ref) => GoogleCustomerIdentityProvider(),
);
final workspaceRepositoryProvider = Provider<WorkspaceRepository>(
  (ref) => WorkspaceRepository(
    ref.watch(apiClientProvider),
    ref.watch(workspaceCacheProvider),
  ),
);
final sessionControllerProvider =
    NotifierProvider<SessionController, SessionState>(SessionController.new);
