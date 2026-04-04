import React from 'react';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import HeroSection from './components/sections/HeroSection';
import ShowSection from './components/sections/ShowSection';
import AssociationSection from './components/sections/AssociationSection';
import EventsSection from './components/sections/EventsSection';
import SupportSection from './components/sections/SupportSection';
import TicketingSection from './components/sections/TicketingSection';
import ContactSection from './components/sections/ContactSection';

function App() {
  return (
    <div className="bg-background min-h-screen">
      <Navbar />
      <main>
        <HeroSection />
        <ShowSection />
        <AssociationSection />
        <EventsSection />
        <SupportSection />
        <TicketingSection />
        <ContactSection />
      </main>
      <Footer />
    </div>
  );
}

export default App;
