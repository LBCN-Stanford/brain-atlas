/* Atlas v2 draws everything in fsaverage, whose surface RAS is MNI305. The site table's
   common-space midpoint is MNI305 on the real build and MNI152 on the synthetic one -- the
   ninefold defect shape in AGENTS.md -- and `sitePoint(site, 'common')` answers in MNI152, the
   wrong frame for this scene by ~2.2 mm. This is the one place v2 resolves a site to MNI305, and
   it refuses rather than guesses, exactly as commonPointInMni152 does. */

import { FREESURFER_MNI305_TO_MNI152 } from '../../lib/space/coordinateSpace'

export interface Mni305Input {
  mni_midpoint_x: number | null
  mni_midpoint_y: number | null
  mni_midpoint_z: number | null
  coordinate_provenance?: { common_coordinate_space?: string; space_evidence?: string } | null
}

/** Inverse of the reviewed MNI305 -> MNI152 affine, computed once from the declared matrix. */
const MNI152_TO_MNI305: number[][] = (() => {
  const m = FREESURFER_MNI305_TO_MNI152.matrix!
  const a = [[m[0][0], m[0][1], m[0][2]], [m[1][0], m[1][1], m[1][2]], [m[2][0], m[2][1], m[2][2]]]
  const t = [m[0][3], m[1][3], m[2][3]]
  const det =
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const inv = [
    [(a[1][1] * a[2][2] - a[1][2] * a[2][1]) / det, (a[0][2] * a[2][1] - a[0][1] * a[2][2]) / det, (a[0][1] * a[1][2] - a[0][2] * a[1][1]) / det],
    [(a[1][2] * a[2][0] - a[1][0] * a[2][2]) / det, (a[0][0] * a[2][2] - a[0][2] * a[2][0]) / det, (a[0][2] * a[1][0] - a[0][0] * a[1][2]) / det],
    [(a[1][0] * a[2][1] - a[1][1] * a[2][0]) / det, (a[0][1] * a[2][0] - a[0][0] * a[2][1]) / det, (a[0][0] * a[1][1] - a[0][1] * a[1][0]) / det],
  ]
  return inv.map((row) => [...row, -(row[0] * t[0] + row[1] * t[1] + row[2] * t[2])])
})()

/**
 * The site's midpoint in MNI305 (= fsaverage), or null when the stored point cannot be placed
 * there. 'mni305' passes through; 'mni152' (the synthetic build) is converted with the inverse of
 * the reviewed affine; anything else -- 'unknown', 'native', or a subject whose registration is
 * recorded as failed -- is refused.
 */
export function sitePointMni305(site: Mni305Input): [number, number, number] | null {
  const p = [site.mni_midpoint_x, site.mni_midpoint_y, site.mni_midpoint_z]
  if (!p.every((v): v is number => typeof v === 'number' && Number.isFinite(v))) return null
  const prov = site.coordinate_provenance
  if (!prov || prov.space_evidence === 'subject_failed') return null
  const [x, y, z] = p as [number, number, number]
  if (prov.common_coordinate_space === 'mni305') return [x, y, z]
  if (prov.common_coordinate_space === 'mni152') {
    const m = MNI152_TO_MNI305
    return [
      m[0][0] * x + m[0][1] * y + m[0][2] * z + m[0][3],
      m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3],
      m[2][0] * x + m[2][1] * y + m[2][2] * z + m[2][3],
    ]
  }
  return null
}
