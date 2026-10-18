"""Paginated laboratory research PDF, rendered only from a saved analysis snapshot."""

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    LongTable,
    PageTemplate,
    Paragraph,
    Spacer,
    TableStyle,
)

from crispr_backend.reporting import LabReport

# The library ships these fonts; no network font fetch or machine-specific paths.
FONT_DIR = Path(reportlab.__file__).parent / "fonts"
pdfmetrics.registerFont(TTFont("Genome", str(FONT_DIR / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("GenomeBold", str(FONT_DIR / "VeraBd.ttf")))
pdfmetrics.registerFontFamily("Genome", normal="Genome", bold="GenomeBold")
INK = colors.HexColor("#17211e")
MUTED = colors.HexColor("#68716d")
RULE = colors.HexColor("#d9dedb")
PAGE_WIDTH, PAGE_HEIGHT = A4
PAGE_MARGIN = 52
CONTENT_WIDTH = PAGE_WIDTH - 2 * PAGE_MARGIN


def render_lab_pdf(report: LabReport) -> bytes:
    """No model calls, database writes, remote resources, or interpretation of eligibility."""
    output = BytesIO()
    normal = ParagraphStyle("Body", fontName="Genome", fontSize=9, leading=14, textColor=INK, spaceAfter=8)
    small = ParagraphStyle("Small", parent=normal, fontSize=7.5, leading=11.5, textColor=MUTED)
    heading = ParagraphStyle(
        "Heading",
        parent=normal,
        fontName="GenomeBold",
        fontSize=12,
        leading=17,
        spaceBefore=20,
        spaceAfter=10,
        keepWithNext=True,
    )
    subheading = ParagraphStyle("Subheading", parent=heading, fontSize=9, leading=14, spaceBefore=12, spaceAfter=7)
    sequence = ParagraphStyle(
        "Sequence", parent=small, fontName="Courier", fontSize=7, leading=11, textColor=INK, splitLongWords=True
    )
    label = ParagraphStyle("Label", parent=small, spaceAfter=0)
    value = ParagraphStyle("Value", parent=label, textColor=INK, alignment=TA_RIGHT)
    column_label = ParagraphStyle("Column label", parent=label, fontName="GenomeBold", fontSize=7)
    column_right = ParagraphStyle("Column right", parent=column_label, alignment=TA_RIGHT)
    numeric = ParagraphStyle("Numeric", parent=value, fontSize=8)
    strand = ParagraphStyle("Strand", parent=numeric, alignment=TA_CENTER)

    def paragraph(value: object, style: ParagraphStyle = normal) -> Paragraph:
        # Report strings are data, never ReportLab markup or external links/images.
        text = "Not available" if value is None else str(value)
        return Paragraph(escape(text).replace("\n", "<br/>"), style)

    def table(rows: list[list[object]], widths: list[float], *, header: bool = False) -> LongTable:
        cells = []
        for row_index, row in enumerate(rows):
            if header:
                styles = (
                    [column_label if index < 2 else column_right for index in range(len(row))]
                    if row_index == 0
                    else [sequence, strand, *([numeric] * (len(row) - 2))]
                )
            else:
                styles = [label, value]
            cells.append([paragraph(item, style) for item, style in zip(row, styles, strict=True)])
        result = LongTable(cells, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
        commands = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]
        if header:
            commands.extend(
                [
                    ("LINEBELOW", (0, 0), (-1, 0), 0.5, RULE),
                    ("LINEBELOW", (0, -1), (-1, -1), 0.5, RULE),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
                ]
            )
        result.setStyle(TableStyle(commands))
        return result

    def page_chrome(canvas, document):
        canvas.saveState()
        # Match the app's compact, tightly tracked wordmark without a machine-specific font.
        wordmark = canvas.beginText(PAGE_MARGIN, PAGE_HEIGHT - 58)
        wordmark.setFont("GenomeBold", 26)
        wordmark.setCharSpace(-1.15)
        wordmark.setFillColor(INK)
        wordmark.textOut("Genome")
        wordmark.setCharSpace(0)
        canvas.drawText(wordmark)
        canvas.setFont("Genome", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 45, "LABORATORY REPORT")
        canvas.drawRightString(PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 58, "GRCh38 / RESEARCH USE")
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(PAGE_MARGIN, PAGE_HEIGHT - 76, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 76)
        canvas.line(PAGE_MARGIN, 48, PAGE_WIDTH - PAGE_MARGIN, 48)
        canvas.setFont("Genome", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(PAGE_MARGIN, 33, "Genome / Research use only / Not a clinical prescription")
        canvas.drawRightString(PAGE_WIDTH - PAGE_MARGIN, 33, f"Page {document.page:02d}")
        canvas.restoreState()

    analysis = report.analysis
    title = ParagraphStyle("Title", parent=heading, fontSize=22, leading=28, spaceBefore=0, spaceAfter=7)
    completed = datetime.fromisoformat(report.analyzed_at).astimezone(UTC).strftime("%d %b %Y, %H:%M UTC")
    story = [
        paragraph("Laboratory report", title),
        paragraph("A record of your saved genome analysis.", small),
        Spacer(1, 10),
        table(
            [
                ["Report reference", report.upload_id],
                ["Analysis completed", completed],
                ["Reference assembly", "GRCh38 / 1-based variant coordinates"],
            ],
            [145, CONTENT_WIDTH - 145],
        ),
        paragraph("Analysis summary", heading),
        paragraph(analysis.conclusion.label, subheading),
        paragraph(analysis.summary.text),
        paragraph(
            "Clinical eligibility has not been established. The editing score estimates predicted cutting "
            "activity, not successful correction, delivery, safety, or treatment benefit. Off-target activity "
            "requires an independent genome-wide assessment. Confirm variants and treatment suitability with "
            "a qualified clinical team."
        ),
    ]
    if not analysis.findings:
        story.append(paragraph("No findings in the screened panel. This does not exclude other genetic conditions."))

    for finding in analysis.findings:
        story.extend(
            [
                HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=16, spaceAfter=2),
                KeepTogether(
                    [
                        paragraph(f"{finding.gene} - {finding.disease}", heading),
                        paragraph(
                            f"Finding tier: {finding.tier} | Inheritance: {finding.inheritance or 'not available'}",
                            small,
                        ),
                    ]
                ),
                paragraph(finding.genotype.explanation if finding.genotype else "Genotype evidence not available."),
            ]
        )
        if finding.omim_id:
            story.append(paragraph(f"Disease reference: {finding.omim_id}", small))
        for variant in finding.variants:
            story.extend(
                [
                    paragraph(variant.name or f"ClinVar variation {variant.variation_id}", subheading),
                    table(
                        [
                            ["GRCh38 location (1-based)", f"Chr {variant.chrom}:{variant.pos}"],
                            ["Reference / alternate", f"{variant.ref} / {variant.alt}"],
                            ["Classification", f"{variant.significance}; {variant.zygosity}"],
                            ["ClinVar evidence", f"Variation {variant.variation_id}; {variant.stars}/4 review stars"],
                            ["Phase / haplotypes", ", ".join(map(str, variant.haplotypes)) or "Unknown"],
                        ],
                        [155, CONTENT_WIDTH - 155],
                    ),
                ]
            )
        if finding.tier == "carrier":
            story.append(paragraph("Carrier finding: no editing target is proposed by this analysis."))
            continue
        for edit in finding.crispr:
            story.extend(
                [
                    paragraph(f"Proposed edit: {edit.variant or edit.variation_id}", subheading),
                    paragraph(edit.strategy),
                    paragraph(f"Rationale: {edit.rationale}"),
                    paragraph(f"Alternative approach: {edit.alternative}"),
                    paragraph("Off-target assessment", subheading),
                    paragraph(edit.off_target),
                ]
            )
            if edit.advisability:
                advice = edit.advisability
                score = "Unavailable" if advice.score is None else f"{advice.score:g}/100"
                story.extend(
                    [
                        paragraph(f"Predicted guide activity: {score}; provisional threshold {advice.threshold:g}"),
                        paragraph(f"Guides scored: {advice.guides_scored}; skipped: {advice.guides_skipped}", small),
                        paragraph(advice.basis, small),
                    ]
                )
            if not edit.guides:
                story.append(paragraph("No suitable SpCas9 guide was found."))
            else:
                rows: list[list[object]] = [
                    ["Guide (5' to 3') / PAM", "Strand", "Cut position", "Distance (bp)", "Rule score", "Activity /100"]
                ]
                for guide in edit.guides:
                    rows.append(
                        [
                            f"{guide.spacer}\nPAM {guide.pam}",
                            guide.strand,
                            guide.cut_position,
                            guide.cut_distance,
                            guide.score,
                            "Unavailable" if guide.efficiency is None else f"{guide.efficiency:.1f}",
                        ]
                    )
                story.append(table(rows, [175, 42, 70, 64, 58, CONTENT_WIDTH - 409], header=True))
                for index, guide in enumerate(edit.guides, 1):
                    story.extend(
                        [
                            paragraph(f"Guide {index}: {guide.spacer}", subheading),
                            paragraph(
                                f"GC content: {guide.gc_content:.0%}; allele match: {'mutant only' if guide.allele_specific else 'also matches healthy allele'}",
                                small,
                            ),
                            paragraph(f"Model context (30 nt): {guide.context or 'Unavailable'}", sequence),
                        ]
                    )
                    story.extend(paragraph(note, small) for note in guide.notes)
                    if guide.model_scores:
                        story.append(
                            paragraph(
                                "Model predictions: "
                                + "; ".join(f"{name}: {value:.2f}" for name, value in guide.model_scores.items()),
                                small,
                            )
                        )
                    if guide.energy:
                        story.append(
                            paragraph(
                                "CRISPRoff energy terms (kcal/mol): "
                                + "; ".join(f"{name}: {value:.2f}" for name, value in guide.energy.items()),
                                small,
                            )
                        )
            if edit.repair_template:
                bases = "\n".join(
                    edit.repair_template[start : start + 60] for start in range(0, len(edit.repair_template), 60)
                )
                story.append(
                    KeepTogether(
                        [
                            paragraph(f"Repair template ({len(edit.repair_template)} nt)", subheading),
                            paragraph(bases, sequence),
                        ]
                    )
                )
            if edit.repair_template_notes:
                story.append(paragraph(edit.repair_template_notes, small))
            story.append(Spacer(1, 10))
    story.extend(
        [
            paragraph("Analysis record", heading),
            table(
                [
                    ["Records scanned", f"{report.records_scanned:,}"],
                    ["Variants checked", f"{analysis.genome.variants_checked:,}"],
                    ["Panel genes screened", ", ".join(analysis.genome.panel_genes)],
                    ["Genome SHA-256", report.sha256],
                ],
                [145, CONTENT_WIDTH - 145],
            ),
            paragraph("Research limitations", heading),
            paragraph(analysis.disclaimer, small),
        ]
    )
    document = BaseDocTemplate(
        output,
        pagesize=A4,
        rightMargin=PAGE_MARGIN,
        leftMargin=PAGE_MARGIN,
        topMargin=98,
        bottomMargin=66,
        title="Genome Laboratory Report",
        author="Genome",
        pageCompression=1,
    )
    document.addPageTemplates(
        PageTemplate(
            id="Genome",
            frames=[
                Frame(
                    document.leftMargin,
                    document.bottomMargin,
                    document.width,
                    document.height,
                    leftPadding=0,
                    rightPadding=0,
                    topPadding=0,
                    bottomPadding=0,
                )
            ],
            onPage=page_chrome,
        )
    )
    document.build(story)
    return output.getvalue()
