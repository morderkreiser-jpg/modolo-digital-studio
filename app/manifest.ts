import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: SITE.ivory, // #F7F3EC
    theme_color: SITE.dark, // #1F1B16
    icons: [
      // Served from public/ at stable paths (app/icon.png is hashed and not addressable here).
      { src: "/logo-icon.png", sizes: "1254x1254", type: "image/png", purpose: "any" },
    ],
  };
}
