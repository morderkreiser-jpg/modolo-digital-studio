import type { Metadata } from "next";
import Home from "@/components/home";
import JsonLd from "@/components/json-ld";
import { homeGraph } from "@/lib/json-ld";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Page() {
  return (
    <>
      <JsonLd data={homeGraph()} />
      <Home />
    </>
  );
}
