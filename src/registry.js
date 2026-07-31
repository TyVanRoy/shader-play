import { CurlFlow } from './pieces/CurlFlow.js';
import { Orbitals } from './pieces/Orbitals.js';
import { Attractors } from './pieces/Attractors.js';
import { SDFField } from './pieces/SDFField.js';
import { MeshWarp } from './pieces/MeshWarp.js';

/**
 * The piece manifest. Order is the default sequence.
 *
 * Five pieces yield twenty ordered transitions. Three of them share `points-v1`,
 * so six of those twenty are state blends. The ones actually worth watching:
 *
 *   CurlFlow ↔ Orbitals      shared state, mismatched *timescales* — the
 *                            original hard tier-3 pair
 *   CurlFlow ↔ Attractors    shared state, mismatched *spatial support* — a
 *                            space-filling flow against a thin manifold, which
 *                            is the newer and probably harder case
 *   SDFField ↔ MeshWarp      the hard bookend pair — nothing in common, no
 *                            shared state possible
 *
 * Ordered so the default cycle walks the whole tier-3 family and then hits the
 * hard bookend pair, without being asked.
 */
export const registry = [CurlFlow, Orbitals, Attractors, SDFField, MeshWarp];
