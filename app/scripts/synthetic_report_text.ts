/* Rewrites the report TEXT of the committed synthetic reports.json with syntheticReports.ts,
   leaving every other field, every other table and every null exactly as they are. It refuses to
   touch a release that is not marked synthetic.

   Usage: npx tsx scripts/synthetic_report_text.ts [--check]   (--check: exit 1 if out of date) */
import { readFileSync, writeFileSync } from 'node:fs'
import { syntheticReport, type SyntheticLabel } from './syntheticReports.ts'

const DIR = new URL('../public/data/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as { synthetic?: boolean }
if (manifest.synthetic !== true) throw new Error('public/data is not marked synthetic: refusing to write report text')
const labels = new Map((JSON.parse(readFileSync(new URL('effect_labels.json', DIR), 'utf8')) as SyntheticLabel[]).map((l) => [l.event_id, l]))
const reports = JSON.parse(readFileSync(new URL('reports.json', DIR), 'utf8')) as { event_id: string; raw_report_redacted: string | null }[]
let changed = 0
for (const r of reports) {
  if (r.raw_report_redacted == null) continue
  const l = labels.get(r.event_id)
  if (!l) throw new Error(`no effect label for ${r.event_id}`)
  const t = syntheticReport(l)
  if (t !== r.raw_report_redacted) { r.raw_report_redacted = t; changed++ }
}
if (process.argv.includes('--check')) {
  console.log(changed ? `${changed} report texts are out of date` : 'synthetic report text is current')
  process.exit(changed ? 1 : 0)
}
writeFileSync(new URL('reports.json', DIR), JSON.stringify(reports))
// the CSV mirror, written exactly as scripts/generate.ts writes it (toCsv there)
const esc = (v: unknown) => {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return `"${v.join('|')}"`
  const t = String(v)
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
const rows = reports as unknown as Record<string, unknown>[]
const cols = Object.keys(rows[0])
writeFileSync(new URL('csv/reports.csv', DIR), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'))
console.log(`rewrote ${changed} of ${reports.length} synthetic report texts`)
