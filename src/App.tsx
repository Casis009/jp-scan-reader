import { Route, Routes } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import HomePage from './pages/HomePage'
import ScanPage from './pages/ScanPage'
import ResultPage from './pages/ResultPage'
import VocabPage from './pages/VocabPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/result/:id" element={<ResultPage />} />
        <Route path="/vocab" element={<VocabPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
      <BottomNav />
    </>
  )
}
