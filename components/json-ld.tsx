// Presentational component (NO "use client") that emits a JSON-LD <script>.
// Renders server-side when mounted from a server component (layout / server page),
// so the structured data is present in the initial HTML for crawlers.
export default function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  return (
    <script
      type="application/ld+json"
      // Escape "<" so a "</script>" inside any string can't break out of the tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
