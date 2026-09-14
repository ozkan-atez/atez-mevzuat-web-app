import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './features/dashboard/Dashboard';
import { ChatScreen } from './features/chat/ChatScreen';
import { ReportDetail } from './features/reports/ReportDetail';
import { RunReportDetail } from './features/reports/RunReportDetail';
import { RunDetail } from './features/runs/RunDetail';
import { GroupsPage } from './features/groups/GroupsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reports/:id" element={<ReportDetail />} />
          <Route path="/runs/:runId/reports/:reportId" element={<RunReportDetail />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/chat" element={<ChatScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
