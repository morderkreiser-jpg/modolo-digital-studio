import { SITE } from "@/lib/site";
import type { Region } from "@/lib/region";

// One way to build every WhatsApp link on the site. The prefilled text carries a short source
// tag in brackets, e.g. "(Website · Start)": it is the only attribution Francesco gets, because
// it arrives written inside the chat. Region IT switches to the Italian number.
export function waHref(text: string, region: Region = "ch"): string {
  const num = (region === "it" ? SITE.phoneIt : SITE.phone).replace(/[^0-9]/g, "");
  return `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
}
