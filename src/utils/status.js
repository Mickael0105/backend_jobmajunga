export const applicationStatusOrder = [
  "sent",
  "viewed",
  "reviewing",
  "interview",
  "accepted",
  "rejected",
];

export function canProgressApplicationStatus(fromStatus, toStatus) {
  const from = applicationStatusOrder.indexOf(fromStatus);
  const to = applicationStatusOrder.indexOf(toStatus);
  if (from === -1 || to === -1) return false;
  return to >= from;
}

