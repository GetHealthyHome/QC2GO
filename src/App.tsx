import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './lib/store';
import { useAuth } from './lib/auth';
import { SignInScreen } from './screens/SignInScreen';
import { HomeScreen } from './screens/HomeScreen';
import { CustomerFormScreen } from './screens/CustomerFormScreen';
import { CustomerScreen } from './screens/CustomerScreen';
import { QuickAuditScreen } from './screens/QuickAuditScreen';
import { InspectionScreen } from './screens/InspectionScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ChecklistsScreen } from './screens/ChecklistsScreen';
import { ChecklistEditorScreen } from './screens/ChecklistEditorScreen';
import { SharedEditorScreen } from './screens/SharedEditorScreen';
import { CompletedScreen } from './screens/CompletedScreen';
import { OfflineBanner } from './components/OfflineBanner';
import { LocalModeBanner } from './components/LocalModeBanner';

export default function App() {
  const { ready } = useStore();
  const auth = useAuth();

  if (!ready || !auth.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-500">
          <div className="size-8 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
          <p className="text-sm font-medium">Loading inspections…</p>
        </div>
      </div>
    );
  }

  // With a backend configured, nothing is reachable without an account.
  if (auth.enabled && !auth.session) {
    return <SignInScreen />;
  }

  return (
    <div className="min-h-screen">
      <LocalModeBanner />
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/customers/new" element={<CustomerFormScreen />} />
        <Route path="/customers/:customerId" element={<CustomerScreen />} />
        <Route path="/customers/:customerId/edit" element={<CustomerFormScreen />} />
        <Route path="/safety-audit" element={<QuickAuditScreen />} />
        <Route path="/inspections/:inspectionId" element={<InspectionScreen />} />
        <Route path="/inspections/:inspectionId/review" element={<ReviewScreen />} />
        <Route path="/inspections/:inspectionId/report" element={<ReportScreen />} />
        <Route path="/completed" element={<CompletedScreen />} />
        <Route path="/checklists" element={<ChecklistsScreen />} />
        <Route path="/checklists/shared" element={<SharedEditorScreen />} />
        <Route path="/checklists/:templateId" element={<ChecklistEditorScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
