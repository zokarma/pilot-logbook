// Emits a JSON-LD structured-data block. Server-rendered into the static HTML
// so crawlers and AI answer engines read it without executing JS. Objects come
// from src/lib/seo.ts.

// Inside a <script> block the HTML parser scans for "</script" before the JS
// parser ever sees the text, so that sequence anywhere in the payload closes
// the element early and everything after it becomes live markup — and
// JSON.stringify does not escape "<". Today the input is our own seo.ts
// constants, but this component accepts arbitrary objects, so escape the
// break-out characters here rather than relying on every future caller.
// U+2028/U+2029 are escaped too: legal inside a JSON string, but line
// terminators to a JS parser. All four become \uXXXX, which is valid JSON, so
// the structured data parses identically.
function safeJson(data: unknown): string {
  return JSON.stringify(data).replace(
    /[<>\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJson(data) }}
    />
  );
}
