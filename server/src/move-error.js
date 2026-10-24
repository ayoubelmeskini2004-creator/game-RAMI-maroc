export function moveError(reason) {
  const error=new Error('Coup invalide');
  error.publicReason=reason;
  return error;
}
