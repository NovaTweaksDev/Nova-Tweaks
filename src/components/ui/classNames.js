export function joinClasses(...values) {
  return values.filter(Boolean).join(' ');
}
