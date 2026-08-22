// provider/adapter.mjs
// The dbt-adapter SEAM. `ManifestAdapter` is the stable interface the provider
// depends on; a real warehouse/OpenLineage adapter can slot in later. For v1
// the FixtureManifestAdapter reads the in-memory fixture bundle.

import { manifest, MANIFEST_RUN_TIME } from '../fixtures/manifest.mjs';

/**
 * @typedef {Object} ManifestAdapter
 * @property {(metricId:string)=>object|null} getNode
 * @property {()=>string[]} listMetricIds
 * @property {()=>string} runTime
 */

/** @returns {ManifestAdapter} */
export function createFixtureManifestAdapter(source = manifest, runTime = MANIFEST_RUN_TIME) {
  return {
    getNode(metricId) {
      if (!metricId) return null;
      return Object.prototype.hasOwnProperty.call(source, metricId) ? source[metricId] : null;
    },
    listMetricIds() {
      return Object.keys(source);
    },
    runTime() {
      return runTime;
    },
  };
}
