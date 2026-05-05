import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import ScrollToTop from './components/ScrollToTop';
import HomePage from './pages/HomePage';
import SpectaclePage from './pages/SpectaclePage';
import AssociationPage from './pages/AssociationPage';
import AgendaPage from './pages/AgendaPage';
import BilletteriePage from './pages/BilletteriePage';
import SoutenirPage from './pages/SoutenirPage';
import ContactPage from './pages/ContactPage';

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="bg-background min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/spectacle" element={<SpectaclePage />} />
            <Route path="/association" element={<AssociationPage />} />
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/billetterie" element={<BilletteriePage />} />
            <Route path="/soutenir" element={<SoutenirPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <Footer />
        <Analytics />
      </div>
    </BrowserRouter>
  );
}

export default App;
