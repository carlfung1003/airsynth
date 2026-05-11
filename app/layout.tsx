import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AirSynth — play piano with your hands",
  description:
    "A gesture-driven piano in the browser. Right hand points at a chord; left hand makes a shape (fist · peace · thumbs up) to pick how the chord plays. No instrument required.",
  metadataBase: new URL("https://airsynth.carlfung.dev"),
  openGraph: {
    title: "AirSynth — play piano with your hands",
    description:
      "A gesture-driven piano in the browser. Right hand points at a chord; left hand makes a shape to pick the pattern.",
    images: [{ url: "/images/hero.png", width: 1536, height: 1024 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AirSynth — play piano with your hands",
    description:
      "A gesture-driven piano in the browser. Right hand points at a chord; left hand makes a shape to pick the pattern.",
    images: ["/images/hero.png"],
  },
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎹</text></svg>",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0f172a] text-white overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
