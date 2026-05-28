"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { ArrowRight, Code2, Palette, Camera, Mail, MapPin, Phone, Send, Sparkles, Clock, Award, Globe2, Store, Briefcase, ShoppingBag, Building2 } from "lucide-react";

export default function Home() {
  const services = [
    {
      icon: Code2,
      title: "Web & Sviluppo",
      desc: "Siti web moderni, performanti e ottimizzati per la SEO locale. Gestione Google Business per emergere sul territorio.",
      tags: ["Web Design", "Sviluppo", "SEO Locale", "Google Business"],
    },
    {
      icon: Palette,
      title: "Brand & Identità",
      desc: "Costruiamo identità visive memorabili. Dal logo ai template Canva brandizzati, ogni dettaglio racconta il tuo brand.",
      tags: ["Branding", "Identità Visiva", "Template Canva"],
    },
    {
      icon: Camera,
      title: "Contenuti & Visual",
      desc: "Shooting fotografici professionali e gestione social in collaborazione con Project Visibility, specialisti in contenuti.",
      tags: ["Shooting", "Social Media", "Project Visibility"],
    },
    {
      icon: Mail,
      title: "Email Marketing",
      desc: "Newsletter ed email marketing che trasformano i contatti in clienti. Strategie che fanno crescere il tuo business.",
      tags: ["Newsletter", "Email Marketing", "Automation"],
    },
  ];

  const steps = [
    { num: "01", title: "Strategia", desc: "Analizziamo il tuo brand, il mercato e gli obiettivi. Ogni progetto inizia con una direzione chiara." },
    { num: "02", title: "Design", desc: "Trasformiamo la strategia in identità visiva. Eleganza, coerenza e personalità in ogni dettaglio." },
    { num: "03", title: "Sviluppo", desc: "Lanciamo il progetto con tecnologie moderne e ottimizzate. Performance, SEO e cura per l'esperienza utente." },
  ];

  const stats = [
    { value: "100%", label: "Made in Switzerland", icon: Globe2 },
    { value: "24h", label: "Tempo di risposta", icon: Clock },
    { value: "Gratis", label: "Prima consulenza", icon: Sparkles },
    { value: "Premium", label: "Qualità garantita", icon: Award },
  ];

  const sectors = [
    { icon: Store, name: "Ristoranti & Hospitality" },
    { icon: Briefcase, name: "Studi Professionali" },
    { icon: ShoppingBag, name: "E-commerce & Retail" },
    { icon: Building2, name: "B&B & Strutture Ricettive" },
  ];

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#F5F1EA] overflow-x-hidden">
      {/* NAVBAR */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-[#0A0A0A]/80 border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 flex items-center justify-center">
              <Image src="/logo-icon.png" alt="MD" width={36} height={36} />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-light tracking-[0.25em] text-xs sm:text-sm">MODOLO</span>
              <span className="text-[10px] tracking-[0.3em] text-[#D4A574]/70 hidden sm:block">DIGITAL STUDIO</span>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            <a href="#servizi" className="hidden md:block text-sm tracking-wider text-white/60 hover:text-white transition-colors">Servizi</a>
            <a href="#metodo" className="hidden md:block text-sm tracking-wider text-white/60 hover:text-white transition-colors">Metodo</a>
            <a href="#contatti" className="text-xs sm:text-sm tracking-wider border border-[#D4A574]/40 text-[#D4A574] px-4 sm:px-5 py-2 rounded-full hover:bg-[#D4A574] hover:text-black hover:border-[#D4A574] transition-all duration-300">
              Contattaci
            </a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-32 pb-20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A0A0A] via-[#141414] to-[#0A0A0A]" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #D4A574 1px, transparent 0)', backgroundSize: '60px 60px' }} />
        <motion.div
          animate={{ opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-[#D4A574]/[0.08] rounded-full blur-[120px]"
        />
        <motion.div
          animate={{ opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-[#D4A574]/[0.06] rounded-full blur-[100px]"
        />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 }}
          className="relative z-10 text-center max-w-5xl mx-auto"
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#D4A574]/20 bg-[#D4A574]/[0.05] mb-10"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4A574] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D4A574]"></span>
            </span>
            <span className="text-xs tracking-[0.2em] text-[#D4A574] uppercase">Digital Studio · Svizzera</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.2, delay: 0.2 }}
            className="mb-12 flex justify-center"
          >
            <Image src="/logo-full.png" alt="Modolo Digital Studio" width={500} height={250} priority />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="text-4xl md:text-6xl lg:text-7xl font-light tracking-tight mb-8 leading-[1.1]"
          >
            Design, codice e strategia<br />
            <span className="text-[#D4A574] italic font-serif">per brand che vogliono distinguersi.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.8 }}
            className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-12 font-light leading-relaxed"
          >
            Siamo uno studio digitale che trasforma la presenza online di professionisti e aziende in tutta la Svizzera.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 1.1 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            <a href="#servizi" className="group bg-[#D4A574] text-black px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#E0B584] transition-all duration-300 flex items-center gap-2 shadow-[0_0_40px_rgba(212,165,116,0.3)] hover:shadow-[0_0_60px_rgba(212,165,116,0.5)]">
              Scopri i servizi
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a href="#contatti" className="border border-white/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#D4A574]/60 hover:text-[#D4A574] transition-all duration-300">
              Parla con noi
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 2 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="w-[1px] h-12 bg-gradient-to-b from-transparent via-[#D4A574]/40 to-transparent"
          />
        </motion.div>
      </section>

      {/* STATS */}
      <section className="py-20 px-6 lg:px-12 border-y border-white/[0.05] bg-black/40">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="text-center group"
                >
                  <Icon className="w-6 h-6 text-[#D4A574] mx-auto mb-4 opacity-80 group-hover:scale-110 transition-transform" strokeWidth={1.2} />
                  <div className="text-2xl md:text-3xl font-light mb-2">{stat.value}</div>
                  <div className="text-xs md:text-sm text-white/40 tracking-wider">{stat.label}</div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SERVIZI */}
      <section id="servizi" className="py-32 px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="mb-20 text-center"
          >
            <span className="text-[#D4A574] text-xs tracking-[0.3em] uppercase mb-4 block">Cosa facciamo</span>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight">
              Servizi su misura, <span className="italic font-serif text-[#D4A574]">risultati concreti</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {services.map((service, i) => {
              const Icon = service.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: i * 0.1 }}
                  className="group relative p-8 lg:p-10 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-white/[0.02] to-transparent hover:border-[#D4A574]/30 transition-all duration-500 overflow-hidden"
                >
                  <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#D4A574]/0 group-hover:bg-[#D4A574]/[0.08] rounded-full blur-2xl transition-all duration-700" />
                  <div className="relative">
                    <div className="inline-flex p-3 rounded-xl bg-[#D4A574]/10 mb-6 group-hover:bg-[#D4A574]/20 transition-colors">
                      <Icon className="w-7 h-7 text-[#D4A574]" strokeWidth={1.3} />
                    </div>
                    <h3 className="text-2xl font-light mb-4">{service.title}</h3>
                    <p className="text-white/50 mb-6 leading-relaxed font-light">{service.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {service.tags.map((tag) => (
                        <span key={tag} className="text-xs tracking-wider text-white/40 border border-white/10 px-3 py-1.5 rounded-full group-hover:border-[#D4A574]/20 transition-colors">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SETTORI */}
      <section className="py-24 px-6 lg:px-12 bg-black/40 border-y border-white/[0.05]">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <span className="text-[#D4A574] text-xs tracking-[0.3em] uppercase mb-4 block">Per chi lavoriamo</span>
            <h2 className="text-3xl md:text-4xl font-light tracking-tight">
              Settori in cui <span className="italic font-serif text-[#D4A574]">eccelliamo</span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {sectors.map((sector, i) => {
              const Icon = sector.icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="group p-6 rounded-xl border border-white/[0.06] hover:border-[#D4A574]/30 hover:bg-white/[0.02] transition-all duration-300 text-center"
                >
                  <Icon className="w-8 h-8 text-[#D4A574]/70 mx-auto mb-4 group-hover:text-[#D4A574] group-hover:scale-110 transition-all" strokeWidth={1.2} />
                  <p className="text-sm text-white/60 font-light">{sector.name}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* METODO */}
      <section id="metodo" className="py-32 px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="mb-20 text-center"
          >
            <span className="text-[#D4A574] text-xs tracking-[0.3em] uppercase mb-4 block">Il nostro metodo</span>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight">
              Tre fasi, <span className="italic font-serif text-[#D4A574]">una visione</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            <div className="hidden md:block absolute top-12 left-[16.66%] right-[16.66%] h-[1px] bg-gradient-to-r from-transparent via-[#D4A574]/20 to-transparent" />
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.15 }}
                className="relative text-center md:text-left"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border border-[#D4A574]/30 bg-[#0A0A0A] text-[#D4A574] font-serif italic text-2xl mb-6 relative z-10">
                  {step.num}
                </div>
                <h3 className="text-2xl font-light mb-4">{step.title}</h3>
                <p className="text-white/50 font-light leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* QUOTE */}
      <section className="py-32 px-6 lg:px-12 bg-black/40 border-y border-white/[0.05]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-4xl mx-auto text-center"
        >
          <Sparkles className="w-8 h-8 text-[#D4A574] mx-auto mb-8" strokeWidth={1.2} />
          <p className="text-2xl md:text-4xl font-light leading-relaxed italic font-serif">
            "Crediamo che ogni brand abbia una storia unica.<br />
            <span className="text-[#D4A574]">Il nostro lavoro è raccontarla con eleganza.</span>"
          </p>
        </motion.div>
      </section>

      {/* CTA */}
      <section id="contatti" className="py-32 px-6 lg:px-12 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#141414] via-[#0A0A0A] to-[#141414]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-[#D4A574]/[0.08] rounded-full blur-[120px]" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative max-w-4xl mx-auto text-center"
        >
          <span className="text-[#D4A574] text-xs tracking-[0.3em] uppercase mb-6 block">Iniziamo</span>
          <h2 className="text-4xl md:text-6xl font-light tracking-tight mb-6">
            Pronto a <span className="italic font-serif text-[#D4A574]">distinguerti</span>?
          </h2>
          <p className="text-lg md:text-xl text-white/50 mb-12 font-light max-w-2xl mx-auto">
            Raccontaci il tuo progetto. Una consulenza iniziale gratuita per capire come possiamo aiutarti.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-20">
            <a href="mailto:info@modolodigitalstudio.ch" className="group bg-[#D4A574] text-black px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#E0B584] transition-all duration-300 flex items-center gap-2 shadow-[0_0_40px_rgba(212,165,116,0.3)] hover:shadow-[0_0_60px_rgba(212,165,116,0.5)]">
              Scrivici
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a href="tel:+41772237900" className="border border-white/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#D4A574]/60 hover:text-[#D4A574] transition-all duration-300">
              Chiamaci
            </a>
          </div>

          <div className="grid sm:grid-cols-3 gap-8 max-w-3xl mx-auto pt-12 border-t border-white/[0.06]">
            <div className="flex flex-col items-center gap-3">
              <Mail className="w-5 h-5 text-[#D4A574]" strokeWidth={1.3} />
              <a href="mailto:info@modolodigitalstudio.ch" className="text-sm text-white/50 hover:text-[#D4A574] transition-colors">
                info@modolodigitalstudio.ch
              </a>
            </div>
            <div className="flex flex-col items-center gap-3">
              <Phone className="w-5 h-5 text-[#D4A574]" strokeWidth={1.3} />
              <a href="tel:+41772237900" className="text-sm text-white/50 hover:text-[#D4A574] transition-colors">
                +41 77 223 79 00
              </a>
            </div>
            <div className="flex flex-col items-center gap-3">
              <MapPin className="w-5 h-5 text-[#D4A574]" strokeWidth={1.3} />
              <span className="text-sm text-white/50">Tutta la Svizzera</span>
            </div>
          </div>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/[0.06] py-12 px-6 lg:px-12 bg-[#0A0A0A]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Image src="/logo-icon.png" alt="Modolo Digital Studio" width={28} height={28} className="opacity-80" />
            <span className="text-sm text-white/40 tracking-wider">
              © {new Date().getFullYear()} Modolo Digital Studio
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://instagram.com/modolodigitalstudio" target="_blank" rel="noopener noreferrer" className="text-white/40 hover:text-[#D4A574] transition-colors" aria-label="Instagram">
              <Send className="w-5 h-5" strokeWidth={1.5} />
            </a>
            <span className="text-xs text-white/30 tracking-[0.2em] uppercase">Made with care in Switzerland</span>
          </div>
        </div>
      </footer>
    </main>
  );
}