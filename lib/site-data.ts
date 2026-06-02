// Server-importable copy needed for JSON-LD structured data (English only — matches the
// rendered <html lang="en"> and the single canonical URL). Kept in sync with the homepage
// FAQ and the service pages.
import type { ServiceSlug } from "./site";

export const FAQ_EN: { q: string; a: string }[] = [
  {
    q: "How much does a website cost?",
    a: "Every project is tailor-made, so the price depends on your needs: number of pages, features and content to create. That's why we offer a free initial consultation: you tell us about your project and we prepare a clear quote, with no surprises.",
  },
  {
    q: "How long does it take to get the website online?",
    a: "It depends on the complexity, but a showcase website usually takes 2 to 4 weeks from gathering the materials. At the start we define a roadmap together, so you always know where we stand.",
  },
  {
    q: "Do you work all over Switzerland?",
    a: "Yes. We work with clients across Switzerland, remotely and in person when needed. Distance is never an obstacle: most of the work happens online, with regular calls and updates.",
  },
  {
    q: "Do you also handle copy and photography?",
    a: "Absolutely. We can take care of content from start to finish, with professional photo shoots and copywriting. For social media we partner with Project Visibility, specialists in content and page management.",
  },
  {
    q: "Will the website be optimized for Google?",
    a: "Yes, every website we build is SEO-optimized from the start: correct structure, fast loading and Google Business setup to help you get found locally. A strong online presence starts here.",
  },
  {
    q: "What happens after the website goes live?",
    a: "We don't leave you on your own. We offer support and maintenance to keep your site secure and up to date, and we're always available for changes or new ideas. We build lasting relationships, not throwaway projects.",
  },
];

export const SERVICES_EN: Record<ServiceSlug, { title: string; description: string }> = {
  web: {
    title: "Web & Development",
    description:
      "Fast, modern websites optimised for local SEO and Google Business. Web design and development for businesses across Switzerland.",
  },
  brand: {
    title: "Brand & Identity",
    description:
      "Memorable visual identities: logo design, colour and typography systems, brand guidelines and branded templates.",
  },
  content: {
    title: "Content & Visual",
    description:
      "Professional photo shoots and social media management to bring your brand to life, in collaboration with Project Visibility.",
  },
  email: {
    title: "Email Marketing",
    description:
      "Newsletters and automated email campaigns that turn contacts into customers and grow your business.",
  },
};
