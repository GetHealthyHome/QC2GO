import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './lib/store';
import { useAuth } from './lib/auth';
import { SignInScreen } from './screens/SignInScreen';
import { NoOrganizationScreen } from './screens/NoOrganizationScreen';
import { SetPasswordScreen } from './screens/SetPasswordScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { PunchListScreen } from './screens/PunchListScreen';
import { IntegrationsScreen } from './screens/IntegrationsScreen';
import { SharedReportScreen } from './screens/SharedReportScreen';
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
  /*
   * The router's location, not `window.location.hash`.
   *
   * Both say the same thing, but only one of them makes this component
   * re-render when it changes. Moving between two hashes of the same document
   * is not a page load, so a component that reads the address bar directly goes
   * on showing whatever it decided the first time — which meant following a
   * share link from an already-open tab kept showing the sign-in screen.
   */
  const location = useLocation();

  /*
   * A shared report is the one thing in QC2GO reachable without an account, and
   * it is settled before anything else — before the sign-in gate, because a
   * recipient has no account and never will, and before the loading screen,
   * because this screen reads nothing out of the local database.
   *
   * The exemption is this route and nothing else. What it shows is decided
   * entirely by the server: the token is the whole credential, the function on
   * the other end checks expiry, revocation and passcode, and it returns an
   * allow-listed subset of the record. There is no store, no sync and no
   * session behind this screen for a bad token to reach.
   */
  if (location.pathname.startsWith('/shared/')) {
    return (
      <Routes>
        <Route path="/shared/:token" element={<SharedReportScreen />} />
      </Routes>
    );
  }

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

  // With a backend configured, nothing else is reachable without an account.
  if (auth.enabled && !auth.session) {
    return <SignInScreen />;
  }

  // Arrived through an invitation link. They are signed in, but only for as
  // long as this session lasts — a password is what gets them back in tomorrow.
  // Asked before anything else, and before the no-company screen, because an
  // invited account has a company by definition.
  if (auth.enabled && auth.session && auth.needsPassword) {
    return <SetPasswordScreen />;
  }

  // An account exists but belongs to no company. Row-level security would show
  // it an empty app; say so rather than letting it look like lost data.
  if (auth.enabled && auth.profile && !auth.profile.organization) {
    return <NoOrganizationScreen />;
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
        <Route path="/customers/:customerId/punch" element={<PunchListScreen />} />
        <Route path="/safety-audit" element={<QuickAuditScreen />} />
        <Route path="/inspections/:inspectionId" element={<InspectionScreen />} />
        <Route path="/inspections/:inspectionId/review" element={<ReviewScreen />} />
        <Route path="/inspections/:inspectionId/report" element={<ReportScreen />} />
        <Route path="/completed" element={<CompletedScreen />} />
        <Route path="/checklists" element={<ChecklistsScreen />} />
        <Route path="/checklists/shared" element={<SharedEditorScreen />} />
        <Route path="/checklists/:templateId" element={<ChecklistEditorScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/people" element={<PeopleScreen />} />
        <Route path="/integrations" element={<IntegrationsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
