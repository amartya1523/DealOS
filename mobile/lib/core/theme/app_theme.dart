import 'package:flutter/material.dart';

class DealOsColors {
  static const ink = Color(0xFF171713);
  static const cream = Color(0xFFF6F3EB);
  static const coral = Color(0xFFFF6B5F);
  static const orange = Color(0xFFFF4F1F);
  static const amber = Color(0xFFFFBD0A);
  static const violet = Color(0xFF5A50E6);
  static const green = Color(0xFF168766);
}

ThemeData buildDealOsTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: DealOsColors.coral,
    brightness: brightness,
    primary: dark ? const Color(0xFFFF8C82) : DealOsColors.ink,
    secondary: DealOsColors.coral,
    tertiary: DealOsColors.amber,
    surface: dark ? const Color(0xFF201F1B) : const Color(0xFFFFFDF8),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark
        ? const Color(0xFF121210)
        : DealOsColors.cream,
    fontFamily: 'sans-serif',
    appBarTheme: AppBarTheme(
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: dark ? const Color(0xFF121210) : DealOsColors.cream,
      foregroundColor: dark ? Colors.white : DealOsColors.ink,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      color: scheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: scheme.outlineVariant),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
  );
}
