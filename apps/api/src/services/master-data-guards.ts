/** Pure master-data change classification. Keep existing bookings independent from label edits. */
export function requiresResourceReservationCheck(
  existing: { active: boolean; type: string },
  patch: { active?: boolean; type?: string },
): boolean {
  return (patch.active === false && existing.active) ||
    (patch.type !== undefined && patch.type !== existing.type);
}

/** True only when a staff member would become unavailable to already-booked clients. */
export function requiresStaffReservationCheck(
  existing: { active: boolean },
  patch: { active?: boolean },
): boolean {
  return existing.active && patch.active === false;
}

/** Skill removal must not silently strand already booked menu items. */
export function removedSkillIds(existing: readonly string[], next: readonly string[]): string[] {
  const keep = new Set(next);
  return [...new Set(existing)].filter(id => !keep.has(id));
}

/** Existing booked services require their service to remain bookable and on the same equipment type.
 * Price/name/duration edits are safe for already booked customers: the appointment has snapshots. */
export function requiresServiceReservationCheck(
  existing: { active: boolean; resourceType: string | null },
  patch: { active?: boolean; resourceType?: string | null },
): boolean {
  return (existing.active && patch.active === false) ||
    (patch.resourceType !== undefined && patch.resourceType !== existing.resourceType);
}
