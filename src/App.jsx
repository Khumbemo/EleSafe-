import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AlertProvider } from './contexts/AlertContext';
import { OfflineProvider } from './contexts/OfflineContext';

// Screens
import LoginScreen from './modules/auth/LoginScreen';
import OTPVerify from './modules/auth/OTPVerify';
import RegisterScreen from './modules/auth/RegisterScreen';

import IncidentMap from './modules/map/IncidentMap';
import QuickReport from './modules/report/QuickReport';
import FullReportForm from './modules/report/FullReportForm';

import IncidentList from './modules/incidents/IncidentList';
import IncidentDetail from './modules/incidents/IncidentDetail';
import OfficerDashboard from './modules/dashboard/OfficerDashboard';

import UserGuide from './modules/guide/UserGuide';
import AlertHistory from './modules/alerts/AlertHistory';
import AlertSettings from './modules/alerts/AlertSettings';

// Components
import NavBar from './components/NavBar';
import BottomNav from './components/BottomNav';
import FABReport from './components/FABReport';
import AlertBanner from './modules/alerts/AlertBanner';
import EmergencyContacts from './modules/contacts/EmergencyContacts';

// Protected Route Wrapper
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { currentUser, userData, loading } = useAuth();

  if (loading) return <div className="h-screen flex items-center justify-center">Loading...</div>;
  if (!currentUser) return <Navigate to="/login" />;
  if (!userData) return <Navigate to="/register" />;

  if (allowedRoles && !allowedRoles.includes(userData.role)) {
    return <Navigate to="/" />;
  }

  return children;
};

// Home Screen (Default Map View for MVP)
const HomeScreen = () => (
  <div className="h-full flex flex-col">
    <NavBar />
    <AlertBanner />
    <div className="flex-1 relative">
      <IncidentMap />
    </div>
  </div>
);

function AppRoutes() {
  return (
    <div className="h-screen w-full bg-neutral-50 flex flex-col overflow-hidden max-w-md mx-auto relative shadow-2xl">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/verify-otp" element={<OTPVerify />} />
          <Route path="/register" element={<RegisterScreen />} />

          <Route path="/" element={<ProtectedRoute><HomeScreen /></ProtectedRoute>} />
          <Route path="/map" element={<ProtectedRoute><HomeScreen /></ProtectedRoute>} />

          <Route path="/report/quick" element={<ProtectedRoute><QuickReport /></ProtectedRoute>} />
          <Route path="/report/full" element={<ProtectedRoute><FullReportForm /></ProtectedRoute>} />

          <Route path="/incidents" element={<ProtectedRoute allowedRoles={['guard', 'officer', 'admin']}><IncidentList /></ProtectedRoute>} />
          <Route path="/incident/:id" element={<ProtectedRoute><IncidentDetail /></ProtectedRoute>} />

          <Route path="/dashboard" element={<ProtectedRoute allowedRoles={['officer', 'admin']}><OfficerDashboard /></ProtectedRoute>} />

          <Route path="/guide" element={<ProtectedRoute><UserGuide /></ProtectedRoute>} />
          <Route path="/contacts" element={<ProtectedRoute><EmergencyContacts /></ProtectedRoute>} />

          <Route path="/alerts" element={<ProtectedRoute><AlertHistory /></ProtectedRoute>} />
          <Route path="/alerts/settings" element={<ProtectedRoute><AlertSettings /></ProtectedRoute>} />
        </Routes>
      </div>
      <FABReport />
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <OfflineProvider>
        <AlertProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AlertProvider>
      </OfflineProvider>
    </AuthProvider>
  );
}
