import "server-only";
import { query } from "@/lib/db/pool";
import { CREATIONS_RANKING_SQL, CREATORS_RANKING_SQL, periodDays, type RankedCreation, type RankedCreator, type RankingPeriod } from "@/lib/ranking";

export const topCreations = (period: RankingPeriod) => query<RankedCreation>(CREATIONS_RANKING_SQL, [periodDays(period)]);
export const topCreators = (period: RankingPeriod) => query<RankedCreator>(CREATORS_RANKING_SQL, [periodDays(period)]);
