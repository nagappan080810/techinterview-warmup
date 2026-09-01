import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MCQ Interview Drill — Technical Interview Practice",
  description:
    "Agent-generated MCQ practice for Java, React, Angular, Node.js, Spring Boot, System Design, DSA, and more. Pick your stack, difficulty, and job level.",
  keywords: [
    "MCQ",
    "interview prep",
    "technical interview",
    "Java",
    "React",
    "Angular",
    "Node.js",
    "Spring Boot",
    "System Design",
    "DSA",
    "coding interview",
    "practice questions",
  ],
  openGraph: {
    title: "MCQ Interview Drill",
    description:
      "Agent-generated technical MCQ practice — pick your stack, difficulty, and job level.",
    type: "website",
    siteName: "MCQ Interview Drill",
  },
  twitter: {
    card: "summary_large_image",
    title: "MCQ Interview Drill",
    description:
      "Agent-generated technical MCQ practice — pick your stack, difficulty, and job level.",
  },
  robots: { index: true, follow: true },
  other: {
    "application/ld+json": JSON.stringify({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "MCQ Interview Drill",
      description:
        "Agent-generated MCQ practice for technical interviews. Pick your stack, difficulty, and job level.",
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      url: "https://mcq-interview-drill.vercel.app",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    }),
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
