/* Facts about the site itself, in one place: what it is called, who makes it, where its code and
   issue tracker live, and how to cite it. Anything not yet decided is null and is simply not shown,
   so nothing here is a placeholder that could be mistaken for a fact. */

export const SITE = {
  /** the atlas's public name (to be decided by the lab) */
  name: 'Intracranial Stimulation Atlas',
  lab: 'Laboratory of Behavioral and Cognitive Neuroscience (LBCN)',
  labShort: 'LBCN, Parvizi Lab',
  department: 'Department of Neurology and Neurological Sciences',
  institution: 'Stanford University School of Medicine',
  labUrl: 'https://med.stanford.edu/parvizi-lab.html',
  repoUrl: 'https://github.com/LBCN-Stanford/brain-atlas',
  issuesUrl: 'https://github.com/LBCN-Stanford/brain-atlas/issues',
  /** dataset DOI, once the deposit has one (e.g. '10.5281/zenodo.xxxxxxx') */
  datasetDoi: null as string | null,
  /** the descriptor paper, once published */
  paper: null as { citation: string; doi: string } | null,
  /** grant acknowledgements, exactly as the lab gives them */
  funding: [] as string[],
  /** the IRB protocol the real data were collected under */
  irb: 'Stanford IRB protocol 11354',
} as const

/** the build: set by vite.config.ts from git at build time */
export const BUILD = {
  commit: (import.meta.env.VITE_BUILD_COMMIT as string | undefined) || 'dev',
  date: (import.meta.env.VITE_BUILD_DATE as string | undefined) || '',
}

/** The address of this view, as it would be cited (the canonical root plus the query). */
export function viewUrl(): string {
  const u = new URL(window.location.href)
  u.hash = ''
  return u.toString()
}

export interface Citation { text: string; bibtex: string; ris: string; cslJson: string }

/** How to cite the atlas at a release, and (optionally) the view the reader is looking at. */
export function citation(release: string, url: string, accessed: Date): Citation {
  const year = accessed.getFullYear()
  // the reader's own date, as the year and the figure's date are (a UTC date named tomorrow after 17:00 Pacific)
  const day = `${year}-${String(accessed.getMonth() + 1).padStart(2, '0')}-${String(accessed.getDate()).padStart(2, '0')}`
  const doi = SITE.datasetDoi
  const title = `${SITE.name}: subjective responses to electrical stimulation of the human brain, data release ${release}`
  const author = SITE.lab
  const text = `${author}, ${SITE.institution}. ${title}. ${doi ? `doi:${doi}. ` : ''}${url} (accessed ${day}).`
  const key = `lbcn_atlas_${release.replace(/[^\w]/g, '_')}`
  const bibtex = [
    `@misc{${key},`,
    `  author = {{${author}}},`,
    `  title = {{${title}}},`,
    `  year = {${year}},`,
    `  publisher = {${SITE.institution}},`,
    doi ? `  doi = {${doi}},` : null,
    `  url = {${url}},`,
    `  note = {Accessed ${day}}`,
    `}`,
  ].filter(Boolean).join('\n')
  const ris = [
    'TY  - DATA',
    `AU  - ${author}`,
    `TI  - ${title}`,
    `PY  - ${year}`,
    `PB  - ${SITE.institution}`,
    doi ? `DO  - ${doi}` : null,
    `UR  - ${url}`,
    `Y2  - ${day}`,
    'ER  - ',
  ].filter(Boolean).join('\n')
  const cslJson = JSON.stringify([{
    id: key, type: 'dataset', title, author: [{ literal: author }], publisher: SITE.institution,
    issued: { 'date-parts': [[year]] }, accessed: { 'date-parts': [[year, accessed.getMonth() + 1, accessed.getDate()]] },
    URL: url, ...(doi ? { DOI: doi } : {}), version: release,
  }], null, 2)
  return { text, bibtex, ris, cslJson }
}

/** References the page cites, in one list. */
export const REFERENCES = {
  desikan: 'Desikan RS et al. (2006) An automated labeling system for subdividing the human cerebral cortex on MRI scans into gyral based regions of interest. NeuroImage 31:968.',
  destrieux: 'Destrieux C et al. (2010) Automatic parcellation of human cortical gyri and sulci using standard anatomical nomenclature. NeuroImage 53:1.',
  yeo: 'Yeo BTT et al. (2011) The organization of the human cerebral cortex estimated by intrinsic functional connectivity. J Neurophysiol 106:1125.',
  fischl: 'Fischl B et al. (1999) High-resolution intersubject averaging and a coordinate system for the cortical surface. Hum Brain Mapp 8:272.',
  groppe: 'Groppe DM et al. (2017) iELVis: an open source MATLAB toolbox for localizing and visualizing human intracranial electrode data. J Neurosci Methods 281:40.',
  fox: 'Fox KCR et al. (2020) Intrinsic network architecture predicts the effects elicited by intracranial electrical stimulation of the human brain. Nat Hum Behav 4:1039.',
  rangarajan: 'Rangarajan V et al. (2014) Electrical stimulation of the left and right human fusiform gyrus causes different effects in conscious face perception. J Neurosci 34:12828.',
  duong: 'Duong A et al. (2023) Subjective states induced by intracranial electrical stimulation matches the cytoarchitectonic organization of the human insula. Brain Stimul 16:1653.',
  foster: 'Foster BL, Parvizi J (2017) Direct cortical stimulation of human posteromedial cortex. Neurology 88:685. PMID 28100728.',
} as const
