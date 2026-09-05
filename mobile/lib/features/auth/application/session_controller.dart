import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/api/api_client.dart';
import '../../../core/errors/app_exception.dart';
import '../../workspace/domain/models.dart';

enum SessionStatus { booting, unauthenticated, authenticated }

class SessionState {
  const SessionState({
    required this.status,
    this.workspace,
    this.platformDashboard,
    this.busy = false,
    this.offline = false,
    this.error,
    this.notice,
  });

  const SessionState.booting()
    : this(status: SessionStatus.booting, busy: true);

  final SessionStatus status;
  final Workspace? workspace;
  final PlatformDashboard? platformDashboard;
  final bool busy;
  final bool offline;
  final String? error;
  final String? notice;

  SessionState copyWith({
    SessionStatus? status,
    Workspace? workspace,
    PlatformDashboard? platformDashboard,
    bool? busy,
    bool? offline,
    String? error,
    String? notice,
    bool clearError = false,
    bool clearNotice = false,
  }) => SessionState(
    status: status ?? this.status,
    workspace: workspace ?? this.workspace,
    platformDashboard: platformDashboard ?? this.platformDashboard,
    busy: busy ?? this.busy,
    offline: offline ?? this.offline,
    error: clearError ? null : error ?? this.error,
    notice: clearNotice ? null : notice ?? this.notice,
  );
}

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() {
    Future.microtask(restore);
    return const SessionState.booting();
  }

  Future<void> restore() async {
    state = const SessionState.booting();
    try {
      await ref.read(authRepositoryProvider).restore();
      await _loadAuthorized();
    } on AppException catch (error) {
      if (error.isAuthenticationFailure) {
        await _clearProtectedState();
        state = const SessionState(status: SessionStatus.unauthenticated);
        return;
      }
      final cached = await ref.read(workspaceRepositoryProvider).loadCached();
      if (cached != null) {
        state = SessionState(
          status: SessionStatus.authenticated,
          workspace: cached,
          offline: true,
          error: 'Offline — showing the last securely cached workspace.',
        );
      } else {
        state = SessionState(
          status: SessionStatus.unauthenticated,
          error: error.message,
        );
      }
    }
  }

  Future<void> login(
    String identifier,
    String password, {
    bool platformOwner = false,
  }) async {
    state = const SessionState(
      status: SessionStatus.unauthenticated,
      busy: true,
    );
    try {
      await ref.read(workspaceRepositoryProvider).clearCache();
      if (platformOwner) {
        await ref
            .read(authRepositoryProvider)
            .loginPlatformOwner(loginId: identifier, password: password);
      } else {
        await ref
            .read(authRepositoryProvider)
            .login(identifier: identifier, password: password);
      }
      await _loadAuthorized();
    } on AppException catch (error) {
      state = SessionState(
        status: SessionStatus.unauthenticated,
        error: error.message,
      );
    }
  }

  Future<void> signUp({
    required String organization,
    required String name,
    required String email,
    required String password,
  }) async {
    state = const SessionState(
      status: SessionStatus.unauthenticated,
      busy: true,
    );
    try {
      await ref.read(workspaceRepositoryProvider).clearCache();
      await ref
          .read(authRepositoryProvider)
          .signUp(
            organizationName: organization,
            displayName: name,
            email: email,
            password: password,
          );
      await _loadAuthorized();
    } on AppException catch (error) {
      state = SessionState(
        status: SessionStatus.unauthenticated,
        error: error.message,
      );
    }
  }

  Future<void> refresh() async {
    if (state.status != SessionStatus.authenticated) return;
    state = state.copyWith(busy: true, clearError: true, clearNotice: true);
    try {
      await ref.read(authRepositoryProvider).restore();
      await _loadAuthorized();
    } on AppException catch (error) {
      if (error.isAuthenticationFailure) {
        await _clearProtectedState();
        state = const SessionState(
          status: SessionStatus.unauthenticated,
          error: 'Your session expired. Please sign in again.',
        );
      } else {
        state = state.copyWith(
          busy: false,
          offline: true,
          error: error.message,
        );
      }
    }
  }

  Future<bool> mutate(
    String path,
    JsonMap body, {
    String method = 'POST',
    String notice = 'Changes saved.',
  }) async {
    final workspace = state.workspace;
    if (workspace == null || state.offline) {
      state = state.copyWith(
        error:
            'Reconnect before performing this action. High-risk changes are never queued.',
      );
      return false;
    }
    if (workspace.user.readOnlyView) {
      state = state.copyWith(
        error:
            'View As is read-only. Exit the simulated organization before making changes.',
      );
      return false;
    }
    state = state.copyWith(busy: true, clearError: true, clearNotice: true);
    try {
      await ref
          .read(workspaceRepositoryProvider)
          .mutate(path, body, method: method);
      await _loadAuthorized(notice: notice);
      return true;
    } on AppException catch (error) {
      if (error.isAuthenticationFailure) {
        await _clearProtectedState();
        state = const SessionState(
          status: SessionStatus.unauthenticated,
          error: 'Your session expired. Please sign in again.',
        );
      } else {
        state = state.copyWith(busy: false, error: error.message);
      }
      return false;
    }
  }

  Future<void> enterViewAs(String organizationId, {String? userId}) async {
    await _switchContext('/platform/view-as', {
      'organizationId': organizationId,
      'userId': ?userId,
      'reason':
          'Read-only investigation requested from the DealOS mobile platform console.',
    }, 'Read-only organization view enabled.');
  }

  Future<void> exitViewAs() => _switchContext(
    '/platform/view-as/exit',
    const {},
    'Returned to the global platform console.',
  );

  Future<void> logout() async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      await ref.read(authRepositoryProvider).logout();
    } finally {
      await _clearProtectedState();
      state = const SessionState(status: SessionStatus.unauthenticated);
    }
  }

  void dismissMessages() =>
      state = state.copyWith(clearError: true, clearNotice: true);

  Future<void> _switchContext(String path, JsonMap body, String notice) async {
    if (state.offline || state.workspace == null) {
      state = state.copyWith(
        error: 'Reconnect before changing organization context.',
      );
      return;
    }
    state = state.copyWith(busy: true, clearError: true, clearNotice: true);
    await ref.read(workspaceRepositoryProvider).clearCache();
    try {
      await ref.read(workspaceRepositoryProvider).mutate(path, body);
      await ref.read(authRepositoryProvider).restore();
      await _loadAuthorized(notice: notice);
    } on AppException catch (error) {
      // Never retain a previous tenant projection when the server context may
      // already have changed but the replacement projection failed to load.
      await _clearProtectedState();
      state = SessionState(
        status: SessionStatus.unauthenticated,
        error: error.message,
      );
    }
  }

  Future<void> _loadAuthorized({String? notice}) async {
    final workspace = await ref.read(workspaceRepositoryProvider).load();
    PlatformDashboard? platformDashboard;
    if (workspace.user.isPlatformOwner && workspace.organization == null) {
      platformDashboard = await ref
          .read(workspaceRepositoryProvider)
          .loadPlatformDashboard();
    }
    state = SessionState(
      status: SessionStatus.authenticated,
      workspace: workspace,
      platformDashboard: platformDashboard,
      notice: notice,
    );
  }

  Future<void> _clearProtectedState() async {
    await Future.wait([
      ref.read(workspaceRepositoryProvider).clearCache(),
      ref.read(apiClientProvider).clearSession(),
    ]);
  }
}
