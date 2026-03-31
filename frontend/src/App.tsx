import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/shared/Layout'
import DashboardPage from './pages/DashboardPage'
import NewCasePage from './pages/NewCasePage'
import CasesPage from './pages/CasesPage'
import CaseDetailPage from './pages/CaseDetailPage'
import ReviewQueuePage from './pages/ReviewQueuePage'
import AuthoritiesPage from './pages/AuthoritiesPage'
import ChatCasePage from '@/pages/ChatCasePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="cases/chat" element={<ChatCasePage />} />
        <Route path="cases/new" element={<NewCasePage />} />
        <Route path="cases" element={<CasesPage />} />
        <Route path="cases/:id" element={<CaseDetailPage />} />
        <Route path="review" element={<ReviewQueuePage />} />
        <Route path="authorities" element={<AuthoritiesPage />} />
      </Route>
    </Routes>
  )
}
