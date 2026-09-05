import 'package:intl/intl.dart';

double asDouble(Object? value) => switch (value) {
  num number => number.toDouble(),
  String text => double.tryParse(text) ?? 0,
  _ => 0,
};

int asInt(Object? value) => switch (value) {
  int number => number,
  num number => number.toInt(),
  String text => int.tryParse(text) ?? 0,
  _ => 0,
};

String money(Object? value, {String currency = 'INR'}) =>
    NumberFormat.simpleCurrency(
      name: currency,
      decimalDigits: 0,
    ).format(asDouble(value));

String shortDate(Object? value) {
  final parsed = value is DateTime ? value : DateTime.tryParse('$value');
  return parsed == null ? '—' : DateFormat.yMMMd().format(parsed.toLocal());
}

String label(String value) => value
    .toLowerCase()
    .split('_')
    .where((part) => part.isNotEmpty)
    .map((part) => '${part[0].toUpperCase()}${part.substring(1)}')
    .join(' ');
