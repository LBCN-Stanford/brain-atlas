"""Display names for the atlas's areas: one table, used by build_brain_assets.py when it writes the
parcel tables and checked by scripts/tests/test_v2_assets.py against what is served.

Each area keeps two names. NAME is what the page shows: the short anatomical term a neurologist
would use. The full descriptive label (Destrieux et al. 2010's long name, Desikan et al. 2006's
region) stays in the parcel table as `long`, shown in the details and written to downloads.

Destrieux's long names carry their synonyms in parentheses and "or" clauses ("Posterior ramus (or
segment) of the lateral sulcus (or fissure)"); the short name keeps the standard term only. A
combined gyrus-and-sulcus label is named for its gyrus or lobule, as Destrieux's own abbreviations
do (G_and_S_paracentral -> Paracentral lobule); a label that joins two sulci names both.

Checked 17 Oct 2026 against Destrieux et al. 2010 (PMC2937159), Desikan et al. 2006 and Yeo et
al. 2011 (PMC3174820), and against each area's position and overlap on fsaverage.
"""

# Destrieux 2009 (aparc.a2009s), keyed by FreeSurfer's annotation name
DESTRIEUX = {
    "G_and_S_frontomargin": "Frontomarginal gyrus",
    "G_and_S_occipital_inf": "Inferior occipital gyrus",
    "G_and_S_paracentral": "Paracentral lobule",
    "G_and_S_subcentral": "Subcentral gyrus",
    "G_and_S_transv_frontopol": "Transverse frontopolar gyri",
    "G_and_S_cingul-Ant": "Anterior cingulate",
    "G_and_S_cingul-Mid-Ant": "Anterior midcingulate",
    "G_and_S_cingul-Mid-Post": "Posterior midcingulate",
    "G_cingul-Post-dorsal": "Dorsal posterior cingulate",
    "G_cingul-Post-ventral": "Ventral posterior cingulate",
    "G_cuneus": "Cuneus",
    "G_front_inf-Opercular": "Pars opercularis",
    "G_front_inf-Orbital": "Pars orbitalis",
    "G_front_inf-Triangul": "Pars triangularis",
    "G_front_middle": "Middle frontal gyrus",
    "G_front_sup": "Superior frontal gyrus",
    "G_Ins_lg_and_S_cent_ins": "Long insular gyri",
    "G_insular_short": "Short insular gyri",
    "G_occipital_middle": "Middle occipital gyrus",
    "G_occipital_sup": "Superior occipital gyrus",
    "G_oc-temp_lat-fusifor": "Fusiform gyrus",
    "G_oc-temp_med-Lingual": "Lingual gyrus",
    "G_oc-temp_med-Parahip": "Parahippocampal gyrus",
    "G_orbital": "Orbital gyri",
    "G_pariet_inf-Angular": "Angular gyrus",
    "G_pariet_inf-Supramar": "Supramarginal gyrus",
    "G_parietal_sup": "Superior parietal lobule",
    "G_postcentral": "Postcentral gyrus",
    "G_precentral": "Precentral gyrus",
    "G_precuneus": "Precuneus",
    "G_rectus": "Gyrus rectus",
    "G_subcallosal": "Subcallosal gyrus",
    "G_temp_sup-G_T_transv": "Heschl's gyrus",
    "G_temp_sup-Lateral": "Lateral superior temporal gyrus",
    "G_temp_sup-Plan_polar": "Planum polare",
    "G_temp_sup-Plan_tempo": "Planum temporale",
    "G_temporal_inf": "Inferior temporal gyrus",
    "G_temporal_middle": "Middle temporal gyrus",
    "Lat_Fis-ant-Horizont": "Anterior horizontal ramus of the Sylvian fissure",
    "Lat_Fis-ant-Vertical": "Anterior ascending ramus of the Sylvian fissure",
    "Lat_Fis-post": "Posterior ramus of the Sylvian fissure",
    "Pole_occipital": "Occipital pole",
    "Pole_temporal": "Temporal pole",
    "S_calcarine": "Calcarine sulcus",
    "S_central": "Central sulcus",
    "S_cingul-Marginalis": "Marginal ramus of the cingulate sulcus",
    "S_circular_insula_ant": "Anterior circular insular sulcus",
    "S_circular_insula_inf": "Inferior circular insular sulcus",
    "S_circular_insula_sup": "Superior circular insular sulcus",
    "S_collat_transv_ant": "Anterior transverse collateral sulcus",
    "S_collat_transv_post": "Posterior transverse collateral sulcus",
    "S_front_inf": "Inferior frontal sulcus",
    "S_front_middle": "Middle frontal sulcus",
    "S_front_sup": "Superior frontal sulcus",
    "S_interm_prim-Jensen": "Intermediate sulcus of Jensen",
    "S_intrapariet_and_P_trans": "Intraparietal and transverse parietal sulci",
    "S_oc_middle_and_Lunatus": "Middle occipital and lunate sulci",
    "S_oc_sup_and_transversal": "Superior and transverse occipital sulci",
    "S_occipital_ant": "Anterior occipital sulcus",
    "S_oc-temp_lat": "Lateral occipitotemporal sulcus",
    "S_oc-temp_med_and_Lingual": "Collateral and lingual sulci",
    "S_orbital_lateral": "Lateral orbital sulcus",
    "S_orbital_med-olfact": "Olfactory sulcus",
    "S_orbital-H_Shaped": "H-shaped orbital sulcus",
    "S_parieto_occipital": "Parieto-occipital sulcus",
    "S_pericallosal": "Callosal sulcus",
    "S_postcentral": "Postcentral sulcus",
    "S_precentral-inf-part": "Inferior precentral sulcus",
    "S_precentral-sup-part": "Superior precentral sulcus",
    "S_suborbital": "Suborbital sulcus",
    "S_subparietal": "Subparietal sulcus",
    "S_temporal_inf": "Inferior temporal sulcus",
    "S_temporal_sup": "Superior temporal sulcus",
    "S_temporal_transverse": "Transverse temporal sulcus",
}

# Desikan-Killiany (aparc): Desikan et al. 2006's regions, named as structures ("Fusiform gyrus",
# not "Fusiform"). "inferiorparietal" is, in Desikan's words, the inferior parietal gyrus and the
# angular gyrus, between supramarginal and lateral occipital; on fsaverage about a third of it is
# Destrieux's angular gyrus and a third the posterior bank of the superior temporal sulcus.
# "bankssts" is the posterior superior temporal sulcus only.
DK = {
    "bankssts": "Banks of the posterior superior temporal sulcus",
    "caudalanteriorcingulate": "Caudal anterior cingulate",
    "caudalmiddlefrontal": "Caudal middle frontal gyrus",
    "cuneus": "Cuneus",
    "entorhinal": "Entorhinal cortex",
    "fusiform": "Fusiform gyrus",
    "inferiorparietal": "Inferior parietal cortex (with angular gyrus)",
    "inferiortemporal": "Inferior temporal gyrus",
    "isthmuscingulate": "Cingulate isthmus",
    "lateraloccipital": "Lateral occipital cortex",
    "lateralorbitofrontal": "Lateral orbitofrontal cortex",
    "lingual": "Lingual gyrus",
    "medialorbitofrontal": "Medial orbitofrontal cortex",
    "middletemporal": "Middle temporal gyrus",
    "parahippocampal": "Parahippocampal gyrus",
    "paracentral": "Paracentral lobule",
    "parsopercularis": "Pars opercularis",
    "parsorbitalis": "Pars orbitalis",
    "parstriangularis": "Pars triangularis",
    "pericalcarine": "Pericalcarine cortex",
    "postcentral": "Postcentral gyrus",
    "posteriorcingulate": "Posterior cingulate",
    "precentral": "Precentral gyrus",
    "precuneus": "Precuneus",
    "rostralanteriorcingulate": "Rostral anterior cingulate",
    "rostralmiddlefrontal": "Rostral middle frontal gyrus",
    "superiorfrontal": "Superior frontal gyrus",
    "superiorparietal": "Superior parietal lobule",
    "superiortemporal": "Superior temporal gyrus",
    "supramarginal": "Supramarginal gyrus",
    "frontalpole": "Frontal pole",
    "temporalpole": "Temporal pole",
    "transversetemporal": "Transverse temporal gyrus (Heschl's)",
    "insula": "Insula",
}

# Yeo et al. 2011, 7-network solution, as Yeo names them
YEO7 = {
    "7Networks_1": "Visual",
    "7Networks_2": "Somatomotor",
    "7Networks_3": "Dorsal attention",
    "7Networks_4": "Ventral attention",
    "7Networks_5": "Limbic",
    "7Networks_6": "Frontoparietal control",
    "7Networks_7": "Default",
}

# Desikan-Killiany long names (Desikan et al. 2006, Table 1 wording, sentence case): the `long`
# name in the parcel table
DK_LONG = {
    "bankssts": "Banks of the superior temporal sulcus",
    "caudalanteriorcingulate": "Caudal anterior cingulate",
    "caudalmiddlefrontal": "Caudal middle frontal",
    "cuneus": "Cuneus",
    "entorhinal": "Entorhinal",
    "fusiform": "Fusiform",
    "inferiorparietal": "Inferior parietal",
    "inferiortemporal": "Inferior temporal",
    "isthmuscingulate": "Isthmus of the cingulate",
    "lateraloccipital": "Lateral occipital",
    "lateralorbitofrontal": "Lateral orbitofrontal",
    "lingual": "Lingual",
    "medialorbitofrontal": "Medial orbitofrontal",
    "middletemporal": "Middle temporal",
    "parahippocampal": "Parahippocampal",
    "paracentral": "Paracentral",
    "parsopercularis": "Pars opercularis",
    "parsorbitalis": "Pars orbitalis",
    "parstriangularis": "Pars triangularis",
    "pericalcarine": "Pericalcarine",
    "postcentral": "Postcentral",
    "posteriorcingulate": "Posterior cingulate",
    "precentral": "Precentral",
    "precuneus": "Precuneus",
    "rostralanteriorcingulate": "Rostral anterior cingulate",
    "rostralmiddlefrontal": "Rostral middle frontal",
    "superiorfrontal": "Superior frontal",
    "superiorparietal": "Superior parietal",
    "superiortemporal": "Superior temporal",
    "supramarginal": "Supramarginal",
    "frontalpole": "Frontal pole",
    "temporalpole": "Temporal pole",
    "transversetemporal": "Transverse temporal",
    "insula": "Insula",
}

NAMES = {"destrieux": DESTRIEUX, "dk": DK, "yeo7": YEO7}
