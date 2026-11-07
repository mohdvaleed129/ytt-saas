import { Route, Routes } from 'react-router';
import AppShell from './components/layout/AppShell.jsx';
import LandingPage from './pages/LandingPage.jsx';
import GeneratorPage from './pages/GeneratorPage.jsx';
import TranscriptPage from './pages/TranscriptPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<LandingPage />} />
        <Route path="generator" element={<GeneratorPage />} />
        <Route path="transcript/:id" element={<TranscriptPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
