# Disease artwork

These 24 original covers were generated with the built-in `image_gen.imagegen`
tool on 2026-10-18. The HBB cover established the style; each remaining cover was
generated separately using HBB as a style reference. Exact per-asset prompts and
generation identifiers are in `generation.json`. The shipped assets are local
768 × 512 WebP derivatives, encoded at quality 82 and displayed with a 16:10 crop.
They need no external image host or Cloudflare Images binding.

The images are conceptual biological illustrations, not microscopy, patient
data, diagnostic evidence or exact molecular structures. A cover identifies a
condition and stays the same for clear, carrier, possible and likely results.
The report owns status; never infer severity or editing eligibility from artwork.

## Collection

| Gene | Biological motif |
| --- | --- |
| HBB | Sickle-shaped and biconcave red blood cells |
| CFTR | Membrane channel |
| HEXA | Lysosome with lipid ribbons |
| PAH | Enzyme and amino-acid motif |
| GBA1 | Lysosome with lipid discs |
| HFE | Mineral storage motif |
| ATP7B | Copper transport motif |
| SERPINA1 | Alveolar cluster |
| ACADM | Mitochondrion |
| GAA | Lysosome and branched glycogen motif |
| MEFV | Innate immune cell |
| ASPA | Myelinated nerve fiber |
| BCKDHA | Branched amino-acid motif |
| ALDOB | Enzyme and sugar motif |
| FBN1 | Connective-tissue microfibrils |
| TTR | Protein fibrils |
| MYBPC3 | Cardiac muscle fibers |
| NF1 | Peripheral nerve and supporting cell |
| FGFR3 | Cartilage and chondrocyte motif |
| F9 | Fibrin-like mesh and platelets |
| F8 | Platelet and fibrin-like fibers |
| GLA | Lysosome with lipid ribbons |
| G6PD | Intact red blood cell and enzyme motif |
| MECP2 | Branching neuron |

The supported disease/gene list comes from `backend/crispr_backend/panel.py`.
Background references consulted for representative motifs:
[sickle cell disease](https://medlineplus.gov/genetics/condition/sickle-cell-disease/),
[cystic fibrosis](https://medlineplus.gov/genetics/condition/cystic-fibrosis/),
[hemochromatosis](https://medlineplus.gov/genetics/condition/hereditary-hemochromatosis/),
[Wilson disease](https://medlineplus.gov/genetics/condition/wilson-disease/),
[familial Mediterranean fever](https://medlineplus.gov/genetics/condition/familial-mediterranean-fever/),
[Fabry disease](https://medlineplus.gov/genetics/condition/fabry-disease/),
[Canavan disease](https://medlineplus.gov/genetics/condition/canavan-disease/) and
[Rett syndrome](https://medlineplus.gov/genetics/condition/rett-syndrome/).
No photographs or scans were copied from these sources.

## Seed prompt

Use case: stylized-concept. Asset type: production disease-card cover for a
polished genome research UI. Create ONE landscape 3:2 image, not a UI mockup, not
a collage. Subject: a sculptural sickle-shaped red blood cell, with one softly
out-of-focus ordinary biconcave cell behind it, an illustrative biological motif
for sickle cell anemia (HBB). This is conceptual editorial artwork, not a patient
scan or diagnostic microscopy. Art direction for a consistent 24-image
collection: restrained high-end scientific product photography, one clearly
recognizable biological subject centered with generous breathing room;
desaturated coral and muted sea-glass material, soft translucent wax /
frosted-glass cellular surfaces with fine believable texture, a very pale cool
neutral seamless background, diffuse large softbox from upper left, subtle soft
contact shadow, clean smooth contours, crisp focal subject with gently softened
background, quiet premium Apple-like industrial-design finish. Subject occupies
the central 65% of the frame so it crops cleanly to 16:10. No words, labels,
symbols, logos, borders, gradients-as-decoration, HUD graphics, DNA helix
decoration, gore, people, hospital imagery, or dramatic neon. Biological form
must carry the identity, not colored status badges.
