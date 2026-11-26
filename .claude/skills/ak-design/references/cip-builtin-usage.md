# CIP Design (Built-in)

50+ deliverables, 20 styles, 20 industries. Gemini Nano Banana (Flash/Pro).

## CIP: Generate Brief

```bash
python scripts/cip/search.py "tech startup" --cip-brief -b "BrandName"
```

## CIP: Search Domains

```bash
python scripts/cip/search.py "business card letterhead" --domain deliverable
python scripts/cip/search.py "luxury premium elegant" --domain style
python scripts/cip/search.py "hospitality hotel" --domain industry
python scripts/cip/search.py "office reception" --domain mockup
```

## CIP: Generate Mockups

```bash
# With logo (RECOMMENDED)
python scripts/cip/generate.py --brand "TopGroup" --logo /path/to/logo.png --deliverable "business card" --industry "consulting"

# Full CIP set
python scripts/cip/generate.py --brand "TopGroup" --logo /path/to/logo.png --industry "consulting" --set

# Pro model (4K text)
python scripts/cip/generate.py --brand "TopGroup" --logo logo.png --deliverable "business card" --model pro

# Without logo
python scripts/cip/generate.py --brand "TechFlow" --deliverable "business card" --no-logo-prompt
```

Models: `flash` (default, `gemini-2.5-flash-image`), `pro` (`gemini-3-pro-image-preview`)

## CIP: Render HTML Presentation

```bash
python scripts/cip/render-html.py --brand "TopGroup" --industry "consulting" --images /path/to/cip-output
```

**Tip:** Real brand → run `references/brand-asset-protocol.md` first (locate the real logo, do not fabricate). Invented / personal brand → Logo Design section above first.
