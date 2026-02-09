import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import SessionProvider from "@/components/SessionProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://remote-viewer-e3c073898446.herokuapp.com"),
  title: "Remote Viewer",
  description: "Local channel-style playback for your video library",
  
  // Favicons - Next.js will auto-detect files in /app folder:
  // - favicon.ico (already exists)
  // - icon.png (192x192)
  // - apple-icon.png (180x180)
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  
  // Open Graph - for social sharing (Facebook, iMessage, LinkedIn, etc.)
  openGraph: {
    title: "Remote Viewer",
    description: "Local channel-style playback for your video library",
    url: "https://remote-viewer-e3c073898446.herokuapp.com",
    siteName: "Remote Viewer",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Remote Viewer - Channel-style video playback",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  
  // Twitter Card
  twitter: {
    card: "summary_large_image",
    title: "Remote Viewer",
    description: "Local channel-style playback for your video library",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} antialiased`}
      >
        <SessionProvider>
          <GoogleAnalytics />
          <Header />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
