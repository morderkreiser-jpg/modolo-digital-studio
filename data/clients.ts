// Client logos / names for the "trusted by" band in components/testimonials.tsx.
// Leave empty to hide the band. Provide a `logo` path (file placed in /public/clients/) to show
// an image, or just a `name` to render it as text. `href` optionally links to the client's site.
export type Client = {
  name: string;
  logo?: string; // e.g. "/clients/saporivivi.svg"
  href?: string; // e.g. "https://saporivivi.ch"
};

export const CLIENTS: Client[] = [
  // { name: "SaporiVivi", logo: "/clients/saporivivi.svg", href: "https://saporivivi.ch" },
  // { name: "ZüriKey", href: "https://zurikey.ch" },
  // { name: "BJ Studio", href: "https://bjstudiodebelleza.ch" },
];
