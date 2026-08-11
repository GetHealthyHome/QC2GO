import { Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './lib/store';
import { JobsScreen } from './screens/JobsScreen';
import { JobFormScreen } from './screens/JobFormScreen';
import { JobScreen } from './screens/JobScreen';
import { TemplatePickerScreen } from './screens/TemplatePickerScreen';
import { InspectionScreen } from './screens/InspectionScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { ReportScreen } from './screens/ReportScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ChecklistsScreen } from './screens/ChecklistsScreen';
import { ChecklistEditorScreen } from './screens/ChecklistEditorScreen';
import { SharedEditorScreen } from './screens/SharedEditorScreen';
import { CompletedScreen } from './screens/CompletedScreen';
import { OfflineBanner } from './components/OfflineBanner';

export default function App() {
  const { ready } = useStore();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-500">
          <div className="size-8 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" />
          <p className="text-sm font-medium">Loading inspections…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<JobsScreen />} />
        <Route path="/jobs/new" element={<JobFormScreen />} />
        <Route path="/jobs/:jobId" element={<JobScreen />} />
        <Route path="/jobs/:jobId/edit" element={<JobFormScreen />} />
        <Route path="/jobs/:jobId/start" element={<TemplatePickerScreen />} />
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
