import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import ScrollToTop from './components/ScrollToTop';

const HomePage = lazy(() => import('./pages/HomePage'));
const SpectaclePage = lazy(() => import('./pages/SpectaclePage'));
const AssociationPage = lazy(() => import('./pages/AssociationPage'));
const AgendaPage = lazy(() => import('./pages/AgendaPage'));
const BilletteriePage = lazy(() => import('./pages/BilletteriePage'));
const SoutenirPage = lazy(() => import('./pages/SoutenirPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="bg-background min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex flex-col">
          <Suspense fallback={<div className="flex-1" />}>
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
          </Suspense>
        </main>
        <Footer />
        <Analytics />
      </div>
    </BrowserRouter>
  );
}

export default App;
