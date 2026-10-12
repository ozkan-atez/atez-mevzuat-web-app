import { Suspense, lazy } from 'react';
import { Spin } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Dashboard } from './features/dashboard/Dashboard';
import { AuthProvider } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { RequireSession, RequirePermission } from './features/auth/RequireSession';
import './app-shell.css';

const ChatScreen = lazy(() => import('./features/chat/ChatScreen').then((module) => ({ default: module.ChatScreen })));
const ReportDetail = lazy(() => import('./features/reports/ReportDetail').then((module) => ({ default: module.ReportDetail })));
const ReportsIndex = lazy(() => import('./features/reports/ReportsIndex').then((module) => ({ default: module.ReportsIndex })));
const RunReportDetail = lazy(() => import('./features/reports/RunReportDetail').then((module) => ({ default: module.RunReportDetail })));
const RunDetail = lazy(() => import('./features/runs/RunDetail').then((module) => ({ default: module.RunDetail })));
const GroupsPage = lazy(() => import('./features/groups/GroupsPage').then((module) => ({ default: module.GroupsPage })));
const AutomationsPage = lazy(() => import('./features/workspace').then((module) => ({ default: module.AutomationsPage })));
const AutomationDetailPage = lazy(() => import('./features/workspace').then((module) => ({ default: module.AutomationDetailPage })));
const SourcesPage = lazy(() => import('./features/workspace').then((module) => ({ default: module.SourcesPage })));
const TemplatesPage = lazy(() => import('./features/workspace').then((module) => ({ default: module.TemplatesPage })));
const UsagePage = lazy(() => import('./features/workspace').then((module) => ({ default: module.UsagePage })));
const AcademyPage = lazy(() => import('./features/workspace').then((module) => ({ default: module.AcademyPage })));
const AdminPage = lazy(() => import('./features/workspace').then((module) => ({ default: module.AdminPage })));
const SourceRunDetail = lazy(() => import('./features/workspace').then((module) => ({ default: module.SourceRunDetail })));

const DocumentsPage = lazy(() => import('./features/documents/DocumentsPage').then(module => ({ default: module.DocumentsPage })));
const StandaloneReportDetail = lazy(() => import('./features/reports/StandaloneReportDetail').then(module => ({ default: module.StandaloneReportDetail })));
const OperationDetail = lazy(() => import('./features/operations/OperationDetail').then(module => ({ default: module.OperationDetail })));

export default function App() {
  return (
    <BrowserRouter><AuthProvider>
      <Suspense fallback={<div className="atez-route-loading"><Spin size="large" /></div>}><Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireSession />}><Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reports" element={<ReportsIndex />} />
          <Route path="/reports/documents/:id" element={<StandaloneReportDetail />} />
          <Route path="/reports/:id" element={<ReportDetail />} />
          <Route path="/runs/:runId/reports/:reportId" element={<RunReportDetail />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route element={<RequirePermission permission="config.manage" />}><Route path="/groups" element={<GroupsPage />} /></Route>
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/automations/:id" element={<AutomationDetailPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/operations/:id" element={<OperationDetail />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/source-runs/:id" element={<SourceRunDetail />} />
          <Route element={<RequirePermission permission="config.manage" />}><Route path="/templates" element={<TemplatesPage />} /></Route>
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/academy" element={<AcademyPage />} />
          <Route element={<RequirePermission permission="admin.manage" />}><Route path="/admin" element={<AdminPage />} /></Route>
          <Route path="/chat" element={<ChatScreen />} />
          <Route path="/chat/:sessionId" element={<ChatScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route></Route>
      </Routes></Suspense>
    </AuthProvider></BrowserRouter>
  );
}
