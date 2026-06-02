import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#F7F3EC] text-[#1F1B16] px-6 text-center">
      <Image src="/logo-icon.png" alt="Modolo Digital Studio" width={56} height={56} className="mb-8" />
      <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4">Error 404</span>
      <h1 className="text-5xl md:text-7xl font-light tracking-tight mb-4">Page not found</h1>
      <p className="text-[#1F1B16]/55 font-light max-w-md mb-10">
        The page you are looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all"
      >
        Back to homepage
      </Link>
    </main>
  );
}
