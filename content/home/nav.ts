// Nav copy (COPY.md §4 + §17). `NAV_COPY` feeds components/site-nav.tsx on every page (accessible
// names) and, in `overlay` mode, the homepage links, the WhatsApp pill and the mobile drawer.

export const NAV_COPY = {
  de: {
    links: { arbeiten: "Arbeiten", preise: "Preise", ueberMich: "Über mich", faq: "FAQ", kontakt: "Kontakt" }, // → #arbeiten #angebot #chi-siamo #faq #contatti
    drawer: ["Per WhatsApp schreiben", "Arbeiten", "Preise", "Gratis-Check", "Über mich", "FAQ", "Kontakt"],
    whatsappVisible: "WhatsApp",
    whatsappSrOnly: "-Nachricht schreiben", // accessible name = whatsappVisible + whatsappSrOnly = "WhatsApp-Nachricht schreiben"
    logoSrOnly: ", Startseite", // visible "MODOLO DIGITAL STUDIO"
    langButtonAria: "DE, Sprache wählen",
    burgerOpen: "Menü öffnen",
    burgerClose: "Menü schliessen",
  },
  it: {
    links: { arbeiten: "Lavori", preise: "Prezzi", ueberMich: "Chi sono", faq: "FAQ", kontakt: "Contatti" },
    drawer: ["Scrivimi su WhatsApp", "Lavori", "Prezzi", "Controllo gratuito", "Chi sono", "FAQ", "Contatti"],
    whatsappVisible: "WhatsApp",
    whatsappSrOnly: ": scrivimi", // "WhatsApp: scrivimi"
    logoSrOnly: ", pagina iniziale",
    langButtonAria: "IT, cambia lingua",
    burgerOpen: "Apri il menu",
    burgerClose: "Chiudi il menu",
  },
  en: {
    links: { arbeiten: "Work", preise: "Prices", ueberMich: "About", faq: "FAQ", kontakt: "Contact" },
    drawer: ["Message me on WhatsApp", "Work", "Prices", "Free check", "About", "FAQ", "Contact"],
    whatsappVisible: "WhatsApp",
    whatsappSrOnly: ": message me", // "WhatsApp: message me"
    logoSrOnly: ", home",
    langButtonAria: "EN, change language",
    burgerOpen: "Open menu",
    burgerClose: "Close menu",
  },
} as const;

/** Desktop links on the homepage, in this order (SPEC §2.6). */
export const NAV_LINK_HREF = {
  arbeiten: "#arbeiten",
  preise: "#angebot",
  ueberMich: "#chi-siamo",
  faq: "#faq",
  kontakt: "#contatti", // the e-mail form, for office PCs without WhatsApp (the live nav button led here)
} as const;

/** Drawer rows after the WhatsApp row: same order as `NAV_COPY[lang].drawer.slice(1)`. */
export const NAV_DRAWER_HREF = ["#arbeiten", "#angebot", "#gratis-check", "#chi-siamo", "#faq", "#contatti"] as const;
