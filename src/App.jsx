import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import ClientLayout from './components/ClientLayout'
import ExpertLayout from './components/ExpertLayout'

// Client-space pages
import ClientAssistant from './pages/ClientAssistant'
import ElectricityBillAnalysis from './pages/ElectricityBillAnalysis'
import RooftopAnalysis from './pages/RooftopAnalysis'
import ClientReport from './pages/ClientReport'

// Expert-space pages
import ExpertDiagnostic from './pages/ExpertDiagnostic'
import SolarRampForecasting from './pages/SolarRampForecasting'
import AlertsDashboard from './pages/AlertsDashboard'
import Reports from './pages/Reports'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* PUBLIC ENTRY */}
        <Route path="/" element={<LandingPage />} />

        {/* CLIENT SPACE — chatbot first, individual modules accessible too */}
        <Route path="/client" element={<ClientLayout />}>
          <Route index element={<Navigate to="assistant" replace />} />
          <Route path="assistant" element={<ClientAssistant />} />
          <Route path="bill-analysis" element={<ElectricityBillAnalysis />} />
          <Route path="rooftop-analysis" element={<RooftopAnalysis />} />
          <Route path="report" element={<ClientReport />} />
        </Route>

        {/* EXPERT SPACE — diagnostic chatbot + technical modules */}
        <Route path="/expert" element={<ExpertLayout />}>
          <Route index element={<Navigate to="diagnostic" replace />} />
          <Route path="diagnostic" element={<ExpertDiagnostic />} />
          <Route path="solar-ramp" element={<SolarRampForecasting />} />
          <Route path="alerts" element={<AlertsDashboard />} />
          <Route path="customer-dossier" element={<Reports />} />
          {/* Old panel / battery sub-routes redirect to the merged diagnostic */}
          <Route path="panel-inspection" element={<Navigate to="../diagnostic" replace />} />
          <Route path="battery-health" element={<Navigate to="../diagnostic" replace />} />
        </Route>

        {/* Legacy redirects */}
        <Route path="/dashboard" element={<Navigate to="/" replace />} />
        <Route path="/pre-installation/bill-analysis" element={<Navigate to="/client/bill-analysis" replace />} />
        <Route path="/pre-installation/rooftop-analysis" element={<Navigate to="/client/rooftop-analysis" replace />} />
        <Route path="/post-installation/panel-inspection" element={<Navigate to="/expert/diagnostic" replace />} />
        <Route path="/post-installation/battery-health" element={<Navigate to="/expert/diagnostic" replace />} />
        <Route path="/post-installation/solar-ramp" element={<Navigate to="/expert/solar-ramp" replace />} />
        <Route path="/reports" element={<Navigate to="/expert/customer-dossier" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
