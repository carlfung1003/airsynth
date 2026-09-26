import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// One family for the whole game. Archivo's width axis does the work a second
// display face would: expanded for the logotype and chord names, normal for
// UI text, condensed for the HUD. JetBrains Mono only for tempo/key readouts.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const description =
  "A music game you play with your hands. Point at chords with one hand, shape a pattern with the other, and sing along to the setlist.";

export const metadata: Metadata = {
  title: "AirSynth",
  description,
  metadataBase: new URL("https://airsynth.carlfung.dev"),
  openGraph: {
    title: "AirSynth",
    description,
    images: [{ url: "/art/og.jpg", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AirSynth",
    description,
    images: ["/art/og.jpg"],
  },
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, title: "AirSynth", statusBarStyle: "black-translucent" },
};

// Mobile Safari (KAN-219): viewport-fit=cover exposes env(safe-area-inset-*).
// Pinch zoom stays on; double-tap zoom is handled with touch-action in CSS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0c0e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
