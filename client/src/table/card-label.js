// Display only: validators, scoring and physical cards retain V/D/R.
export const cardLabel = (rank) => ({ V: 'J', D: 'Q', R: 'K' })[rank] ?? rank;
