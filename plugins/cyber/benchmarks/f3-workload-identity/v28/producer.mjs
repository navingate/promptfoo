import { buildEpisode as buildV27Episode } from '../v27/producer.mjs';

export function buildEpisode(spec) {
  return buildV27Episode(spec, { expandedCohort: true });
}
