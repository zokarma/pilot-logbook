// Emits a JSON-LD structured-data block. Server-rendered into the static HTML
// so crawlers and AI answer engines read it without executing JS. Objects come
// from src/lib/seo.ts.
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // Structured data is our own trusted content (from seo.ts), not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
