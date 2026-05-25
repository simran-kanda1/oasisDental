import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import {
  buildCoverageRangesByPlanId,
  type DentrixCoverageTableDoc,
} from './procedureCodeTypes';

const coverageCache = new Map<number, DentrixCoverageTableDoc[]>();
const inflight = new Map<number, Promise<DentrixCoverageTableDoc[]>>();

/** Load coverage rows for insurance plans referenced on the current estimate list (cached). */
export async function fetchCoverageForPlans(planIds: number[]): Promise<Map<number, DentrixCoverageTableDoc[]>> {
  const unique = [...new Set(planIds.filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map<number, DentrixCoverageTableDoc[]>();

  await Promise.all(
    unique.map(async (planId) => {
      if (coverageCache.has(planId)) {
        out.set(planId, coverageCache.get(planId)!);
        return;
      }
      let pending = inflight.get(planId);
      if (!pending) {
        pending = getDocs(query(collection(db, 'coverage_tables'), where('table_id', '==', planId))).then((snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DentrixCoverageTableDoc));
          const grouped = buildCoverageRangesByPlanId(rows);
          const list = grouped.get(planId) ?? rows;
          coverageCache.set(planId, list);
          inflight.delete(planId);
          return list;
        });
        inflight.set(planId, pending);
      }
      const rows = await pending;
      out.set(planId, rows);
    })
  );

  return out;
}
