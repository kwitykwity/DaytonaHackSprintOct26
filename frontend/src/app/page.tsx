"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Header from "./components/Header";
import Hero from "./components/Hero";
import StoryGenerator from "./components/StoryGenerator";
import HowItWorks from "./components/HowItWorks";
import ForWhom from "./components/ForWhom";
import DemoPlayer from "./components/DemoPlayer";
import StatsSection from "./components/StatsSection";
import Footer from "./components/Footer";
import NameModal from "./components/NameModal";
import { clearReader, getReaderName } from "./lib/reader";

// Detects hydration without a setState-in-effect; localStorage is client-only.
const emptySubscribe = () => () => {};

export default function Home() {
  const storyGeneratorRef = useRef<HTMLDivElement | null>(null);
  const hydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);
  // Set once the modal is submitted, so it closes without re-reading storage.
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const showNameModal = hydrated && !submittedName && !getReaderName();

  // Dev only: run narrateMeClearReader() in the console to see the modal again.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const w = window as unknown as { narrateMeClearReader?: () => void };
    w.narrateMeClearReader = () => {
      clearReader();
      window.location.reload();
    };
    return () => {
      delete w.narrateMeClearReader;
    };
  }, []);

  const scrollToStoryGenerator = () => {
    if (storyGeneratorRef.current) {
      storyGeneratorRef.current.scrollIntoView({ behavior: "smooth" });
    } else {
      const el = document.getElementById("create-story");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const scrollToDemo = () => {
    const el = document.getElementById("how-it-works");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-base text-ink-dark antialiased">
      {/* First-visit name prompt so the owl can remember the reader */}
      <NameModal open={showNameModal} onDone={setSubmittedName} />

      {/* Fixed Navigation Bar */}
      <Header />

      {/* Main Landing Page Content */}
      <main className="flex-1">
        {/* Hero Section */}
        <Hero
          onCreateStoryClick={scrollToStoryGenerator}
          onSeeDemoClick={scrollToDemo}
        />

        {/* Interactive Story Generator Form */}
        <StoryGenerator sectionRef={storyGeneratorRef} />

        {/* How It Works Section */}
        <HowItWorks />

        {/* For Teachers / Parents Section */}
        <ForWhom onStartStoryClick={scrollToStoryGenerator} />

        {/* Dynamic Multi-Scene Demo Audio Player */}
        <DemoPlayer />

        {/* Platform Metrics & Stats Section */}
        <StatsSection />

        {/* Final Call to Action Banner */}
        <section className="py-24 px-6 md:px-12 lg:px-20 bg-gradient-to-br from-accent-yellow to-accent-coral text-white text-center">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-extrabold mb-6">
              Ready to Bring Stories to Life?
            </h2>
            <p className="text-xl mb-10 opacity-90 leading-relaxed">
              Join thousands of teachers and parents creating magical reading moments every day.
            </p>
            <button
              onClick={scrollToStoryGenerator}
              className="bg-accent-teal text-white px-12 py-4 rounded-full font-bold text-lg hover:bg-ink-dark transition-all transform hover:scale-105 shadow-xl cursor-pointer"
            >
              Start Creating — It's Free
            </button>
            <p className="mt-6 text-sm opacity-80">
              No signup required for your first story.
            </p>
          </div>
        </section>
      </main>

      {/* Footer with Newsletter Endpoint Integration */}
      <Footer />
    </div>
  );
}
