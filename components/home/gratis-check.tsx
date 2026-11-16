"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { waHref } from "@/lib/whatsapp";
import { useRegion } from "@/components/use-region";
import { GRATIS_CHECK_TOKEN, type GratisCheckCopy } from "@/content/home/offer";
import { typo } from "@/components/home/typo";


type Props = {
  lang: Locale;
  copy: GratisCheckCopy;
  /** PREFILL[lang].checkNamed(GRATIS_CHECK_TOKEN) */
  named: string;
  /** PREFILL[lang].checkEmpty */
  empty: string;
  newTab: string;
};

/**
 * Rung 0 of the offer ladder (#gratis-check): the free Google check on video, the lead magnet that
 * brought the first inbound lead (refactor of components/video-review.tsx). The visitor types the
 * name and town of the business and lands in a WhatsApp chat with the request already written,
 * tagged «(Website · Google-Check)». The field may stay empty (the empty prefill is used). Enter
 * in the field opens WhatsApp in a new tab; without JavaScript the button is a plain wa.me link.
 * The number follows the visitor's region (CH / IT).
 */
export default function GratisCheck({ lang, copy, named, empty, newTab }: Props) {
  const [biz, setBiz] = useState("");
  const region = useRegion();
  const name = biz.trim();
  const text = name ? named.split(GRATIS_CHECK_TOKEN).join(name) : empty;
  const href = waHref(text, region);

  return (
    <div
      id="gratis-check"
      className="scroll-mt-[calc(var(--nav-h,80px)+12px)] rounded-[20px] border-[1.5px] border-[#b5893f] bg-[var(--ink-bg)] p-5 sm:p-8 md:p-10 lg:p-12"
    >
      <div className="grid gap-5 md:gap-y-0 mds-split-5-7">
        <div className="min-w-0">
          <p className="micro-caps text-[var(--gilt)]">{typo(copy.step, lang)}</p>
          <h3 className="display-space mt-3 text-[#17130e]" style={{ fontSize: "clamp(1.55rem, 2.6vw, 2.25rem)", lineHeight: 1.08 }}>
            {copy.h3}
          </h3>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] leading-relaxed text-[#17130e]/80 sm:text-[16px] md:text-[17px]">{typo(copy.text, lang)}</p>
          <form
            className="mt-5 md:mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              window.open(href, "_blank", "noopener");
            }}
          >
            <label htmlFor="gratis-check-name" className="block text-[14px] font-medium text-[#17130e]/85">
              {copy.fieldLabel}
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="gratis-check-name"
                type="text"
                name="betrieb"
                value={biz}
                onChange={(e) => setBiz(e.target.value)}
                placeholder={copy.placeholder}
                autoComplete="organization"
                enterKeyHint="send"
                maxLength={120}
                aria-describedby="gratis-check-micro"
                className="h-[54px] w-full min-w-0 rounded-full border border-[#17130e]/55 bg-[#fbf8f2] px-5 text-[16px] text-[#17130e] transition-colors placeholder:text-[#17130e]/60 hover:border-[#17130e]/70 focus:border-[#b5893f] sm:w-auto sm:flex-1"
              />
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-[54px] shrink-0 items-center justify-center gap-2.5 rounded-full px-7 text-[16px] font-semibold text-[#17130e] shadow-[0_12px_28px_-14px_rgba(126,93,36,0.75)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_16px_32px_-14px_rgba(126,93,36,0.85)]"
                style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)" }}
              >
                <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
                {copy.button}
                <span className="sr-only"> {newTab}</span>
              </a>
            </div>
            <p id="gratis-check-micro" className="mt-3 text-[13.5px] leading-relaxed text-[#17130e]/70">
              {copy.micro}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
