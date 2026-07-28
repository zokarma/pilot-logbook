# Scan accuracy fixtures

Real logbook pages and what they *should* extract to. Consumed by
`npx tsx evals/scanAccuracy.live.ts`.

**Everything in this directory except this README and `example.json` is
gitignored.** These are photographs of real logbooks — personal flight data,
same rule as `*.csv` at the repo root. Never commit them, never paste them into
an issue, never attach one to a bug report.

## Layout

Two files per page, same basename:

```
tc-1998-p12.jpg     the photo, exactly as the app would send it
tc-1998-p12.json    what it should extract
```

Supported image types match what the Edge Function accepts: `.jpg`, `.jpeg`,
`.png`, `.webp`, `.gif`, `.pdf`.

**Don't pre-process the photo.** No cropping, rotating, or contrast-boosting
that the app wouldn't do. The point is to measure the pipeline a pilot actually
gets, camera shake included.

## Truth-file format

```jsonc
{
  "mode": "flights",              // or "document"; default "flights"
  "note": "1998 TC book, faded blue ink, water damage bottom-right",
  "ignoreFields": ["notes"],      // columns to leave out of scoring
  "flights": [
    {
      "date": "1998-06-14",
      "aircraftType": "C172",
      "registration": "C-GABC",
      "from": "CYNJ",
      "to": "CYPK",
      "loggedRole": "Dual Received",
      "se": 1.2,
      "xc": 1.2,
      "dayHours": 1.2,
      "pic": "SMITH, J"
    }
  ]
}
```

For `"mode": "document"`, use a single `"document": { … }` object with the
fields `type`, `number`, `issueDate`, `examDate`, `expiryDate`.

A multi-page fixture can name its images explicitly:

```jsonc
{ "images": ["spread-left.jpg", "spread-right.jpg"], "flights": [ … ] }
```

## Labelling rules

These decide what the numbers mean, so they matter more than the sample size.

1. **An omitted field means the page is blank there.** If the model returns a
   value for it, that scores as a false positive — which is what you want, since
   an invented hour is worse than a missing one in a legal document. If a column
   exists but you don't want to label it, put it in `ignoreFields` rather than
   leaving it out.

2. **Label what the page says, not what is correct.** If the pilot wrote the
   wrong ICAO code in 1998, the truth file gets the wrong ICAO code. This
   measures reading, not airmanship.

3. **Label to the app's normalisation.** Dates `YYYY-MM-DD`, hours as decimals
   to the tenth, idents and ICAO codes upper-case. The scorer is forgiving about
   cosmetic differences (registration punctuation, name casing, whitespace) but
   not about substance.

4. **Include the hard pages.** A set of clean pages tells you nothing you don't
   already know. Faded ink, cramped columns, a continuation row, a page where
   the year only appears in the header — those are where the miss rate lives.

5. **One page per fixture** unless you are deliberately testing a spread. Row
   attribution gets ambiguous across pages, and the app is more accurate one
   page at a time anyway.

## Reading the output

- **Per-field F1, worst first.** The first row of that table is the next thing
  to fix. A column with high `miss` is being skipped; high `wrong` is being
  misread; high `spur` is being hallucinated — three different fixes.
- **Rows: matched / missed / spurious.** Missed rows dominate everything else —
  a row that never appears loses every field at once.
- **Review flags.** `uncertain` drives the confirm sheet's highlighting. Flag
  *recall* is the one that matters: errors that reach the pilot unflagged are
  errors that get saved into a legal document. Low recall there is worse than a
  slightly lower F1.

## Sweeping

```sh
# baseline
ANTHROPIC_API_KEY=… npx tsx evals/scanAccuracy.live.ts

# does more thinking pay for itself?
SCAN_EVAL_EFFORT=high ANTHROPIC_API_KEY=… npx tsx evals/scanAccuracy.live.ts

# is Opus worth the money on your pages?
SCAN_EVAL_MODEL=claude-opus-5 ANTHROPIC_API_KEY=… npx tsx evals/scanAccuracy.live.ts
```

Each run prints tokens and an approximate cost, so a win can be weighed against
what it costs per scan. The winning combination is adopted with
`supabase secrets set SCAN_MODEL=… SCAN_EFFORT=…` — no code change, no redeploy
of logic.

Save runs with `SCAN_EVAL_JSON=runs/opus-high.json` to diff them later.
