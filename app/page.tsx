import type { Metadata } from "next";
import Studio from "@/components/Studio";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Page() {
  return <Studio />;
}
