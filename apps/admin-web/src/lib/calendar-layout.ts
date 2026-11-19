/** Layout appointments in concurrent lanes instead of painting overlapping cards
 * on top of each other (particularly important in week view, which groups staff).
 * Intervals that meet exactly at the boundary don't overlap.
 */
export interface TimedItem {
  id: string;
  startAt: string;
  endAt: string;
}
export interface CardLane { lane: number; lanes: number }

export function computeAppointmentLanes<T extends TimedItem>(items: readonly T[]): Map<string, CardLane> {
  const ordered = items.map((item) => ({
    id: item.id,
    start: Date.parse(item.startAt),
    end: Date.parse(item.endAt),
  })).filter((v) => Number.isFinite(v.start) && Number.isFinite(v.end) && v.end > v.start)
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const result = new Map<string, CardLane>();
  let cluster: { id: string; lane: number }[] = [];
  let active = new Map<number, number>();
  let clusterEnd = Number.NEGATIVE_INFINITY;
  let maxLanes = 0;

  const flush = () => {
    for (const row of cluster) result.set(row.id, { lane: row.lane, lanes: maxLanes });
    cluster = [];
    active = new Map();
    maxLanes = 0;
  };
  for (const item of ordered) {
    if (item.start >= clusterEnd && cluster.length) flush();
    for (const [lane, end] of active) {
      if (end <= item.start) active.delete(lane);
    }
    let lane = 0;
    while (active.has(lane)) lane += 1;
    active.set(lane, item.end);
    cluster.push({ id: item.id, lane });
    maxLanes = Math.max(maxLanes, active.size, lane + 1);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}
