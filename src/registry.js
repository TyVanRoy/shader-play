import { CurlFlow } from './pieces/CurlFlow.js';
import { Orbitals } from './pieces/Orbitals.js';
import { SDFField } from './pieces/SDFField.js';
import { MeshWarp } from './pieces/MeshWarp.js';

/**
 * The piece manifest. Order is the default sequence.
 *
 * Four pieces yield twelve ordered transitions, which is enough to tell whether
 * the sequencing idea holds up before committing to a larger library. Two pairs
 * are the ones actually worth watching:
 *
 *   CurlFlow ↔ Orbitals    the hard tier-3 pair — shared points-v1 state,
 *                          badly mismatched timescales
 *   SDFField ↔ MeshWarp    the hard bookend pair — nothing in common, no
 *                          shared state possible
 *
 * Arranged so the default cycle hits both without being asked.
 */
export const registry = [CurlFlow, Orbitals, SDFField, MeshWarp];
