"use client";

// The one interactive bit of section 01: the WhatsApp text link. It is a client island only
// because the number depends on the MDS_REGION cookie (IT visitors get the Italian WhatsApp).
// It receives the current locale's strings as props, so no other locale's copy is shipped.
import { useRegion } from "@/components/use-region";
import { waHref } from "@/lib/whatsapp";

export default function WorkCta({ text, label, className }: { text: string; label: string; className?: string }) {
  const region = useRegion();
  return (
    <a href={waHref(text, region)} target="_blank" rel="noopener noreferrer" className={className}>
      <span>{label}</span>
      <span aria-hidden="true" className="mds-work-cta-arrow">→</span>
    </a>
  );
}
