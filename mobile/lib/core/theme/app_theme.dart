import 'package:flutter/material.dart';

class DealOsColors {
  static const ink = Color(0xFF172033);
  static const cream = Color(0xFFF5F7FB);
  static const coral = Color(0xFFF0645A);
  static const orange = Color(0xFFEA6A32);
  static const amber = Color(0xFFD18A12);
  static const violet = Color(0xFF5865D8);
  static const green = Color(0xFF16836A);
  static const blue = Color(0xFF3657D6);
  static const border = Color(0xFFE5E9F1);
  static const muted = Color(0xFF667085);
}

ThemeData buildDealOsTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final baseScheme = ColorScheme.fromSeed(
    seedColor: DealOsColors.blue,
    brightness: brightness,
  );
  final surface = dark ? const Color(0xFF171A22) : Colors.white;
  final canvas = dark ? const Color(0xFF101218) : DealOsColors.cream;
  final scheme = baseScheme.copyWith(
    primary: dark ? const Color(0xFF9EADFF) : DealOsColors.blue,
    secondary: dark ? const Color(0xFFFF9C93) : DealOsColors.coral,
    tertiary: dark ? const Color(0xFF6FD3B3) : DealOsColors.green,
    surface: surface,
    onSurface: dark ? const Color(0xFFF3F4F8) : DealOsColors.ink,
    onSurfaceVariant: dark ? const Color(0xFFAEB4C2) : DealOsColors.muted,
    outline: dark ? const Color(0xFF505564) : const Color(0xFFCBD1DD),
    outlineVariant: dark ? const Color(0xFF2B2F39) : DealOsColors.border,
    surfaceContainerLowest: surface,
    surfaceContainerLow: dark
        ? const Color(0xFF1B1E27)
        : const Color(0xFFF9FAFC),
    surfaceContainer: dark ? const Color(0xFF20232D) : const Color(0xFFF2F4F8),
    surfaceContainerHigh: dark
        ? const Color(0xFF292D38)
        : const Color(0xFFE9EDF4),
  );
  final baseText = ThemeData(brightness: brightness).textTheme;
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: canvas,
    textTheme: baseText.copyWith(
      displaySmall: baseText.displaySmall?.copyWith(
        fontSize: 36,
        height: 1.1,
        fontWeight: FontWeight.w800,
        letterSpacing: -1.4,
      ),
      headlineMedium: baseText.headlineMedium?.copyWith(
        fontSize: 28,
        height: 1.15,
        fontWeight: FontWeight.w800,
        letterSpacing: -.8,
      ),
      headlineSmall: baseText.headlineSmall?.copyWith(
        fontSize: 23,
        height: 1.2,
        fontWeight: FontWeight.w700,
        letterSpacing: -.4,
      ),
      titleLarge: baseText.titleLarge?.copyWith(
        fontSize: 20,
        height: 1.25,
        fontWeight: FontWeight.w700,
        letterSpacing: -.25,
      ),
      titleMedium: baseText.titleMedium?.copyWith(
        fontSize: 16,
        height: 1.3,
        fontWeight: FontWeight.w700,
      ),
      bodyLarge: baseText.bodyLarge?.copyWith(fontSize: 16, height: 1.45),
      bodyMedium: baseText.bodyMedium?.copyWith(fontSize: 14, height: 1.45),
      labelLarge: baseText.labelLarge?.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w700,
      ),
    ),
    appBarTheme: AppBarTheme(
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      toolbarHeight: 68,
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      foregroundColor: scheme.onSurface,
      titleTextStyle: TextStyle(
        color: scheme.onSurface,
        fontSize: 19,
        height: 1.15,
        fontWeight: FontWeight.w700,
        letterSpacing: -.25,
      ),
    ),
    cardTheme: CardThemeData(
      elevation: dark ? 0 : 1,
      margin: EdgeInsets.zero,
      color: surface,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.black.withValues(alpha: .08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: dark ? scheme.outlineVariant : Colors.transparent,
        ),
      ),
    ),
    listTileTheme: ListTileThemeData(
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 7),
      minVerticalPadding: 12,
      iconColor: scheme.onSurfaceVariant,
      titleTextStyle: TextStyle(
        color: scheme.onSurface,
        fontSize: 15,
        height: 1.3,
        fontWeight: FontWeight.w700,
      ),
      subtitleTextStyle: TextStyle(
        color: scheme.onSurfaceVariant,
        fontSize: 13,
        height: 1.4,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      hintStyle: TextStyle(color: scheme.onSurfaceVariant),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: scheme.primary, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: scheme.error),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 50),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 50),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
        side: BorderSide(color: scheme.outlineVariant),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: scheme.onSurfaceVariant,
        minimumSize: const Size.square(44),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    iconTheme: IconThemeData(color: scheme.onSurfaceVariant, size: 22),
    chipTheme: ChipThemeData(
      backgroundColor: scheme.surfaceContainerLow,
      side: BorderSide(color: scheme.outlineVariant),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      labelStyle: TextStyle(
        color: scheme.onSurfaceVariant,
        fontSize: 12,
        fontWeight: FontWeight.w700,
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: surface,
      surfaceTintColor: Colors.transparent,
      elevation: 8,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 72,
      elevation: 8,
      shadowColor: Colors.black.withValues(alpha: .08),
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: scheme.primary.withValues(alpha: .12),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? scheme.primary
              : scheme.onSurfaceVariant,
          size: 23,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          color: states.contains(WidgetState.selected)
              ? scheme.primary
              : scheme.onSurfaceVariant,
          fontSize: 11,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w600,
        ),
      ),
    ),
    navigationDrawerTheme: NavigationDrawerThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: scheme.primary.withValues(alpha: .12),
      indicatorShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
      ),
    ),
    navigationRailTheme: NavigationRailThemeData(
      backgroundColor: surface,
      indicatorColor: scheme.primary.withValues(alpha: .12),
      selectedIconTheme: IconThemeData(color: scheme.primary),
      selectedLabelTextStyle: TextStyle(
        color: scheme.primary,
        fontWeight: FontWeight.w700,
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: TextStyle(
        color: scheme.onSurface,
        fontSize: 21,
        fontWeight: FontWeight.w800,
      ),
    ),
    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant,
      thickness: 1,
      space: 1,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.primary),
  );
}
