import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProjectList from './pages/ProjectList';
import ProjectDetail from './pages/ProjectDetail';
import ProjectKits from './pages/ProjectKits';
import ProjectBudget from './pages/ProjectBudget';
import ActivityList from './pages/ActivityList';
import ActivityKitList from './pages/ActivityKitList';
import ScheduleKitList from './pages/ScheduleKitList';
import ProjectSchedule from './pages/ProjectSchedule';

function App() {
  return (
    <Router>
      <div className="min-vh-100 bg-light">
        <Navbar />
        <main className="pb-5">
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/projects/:id/kits" element={<ProjectKits />} />
            <Route path="/projects/:id/budget" element={<ProjectBudget />} />
            <Route path="/projects/:id/schedule" element={<ProjectSchedule />} />
            <Route path="/activities" element={<ActivityList />} />
            <Route path="/kits" element={<ActivityKitList />} />
            <Route path="/schedule-kits" element={<ScheduleKitList />} />
            <Route path="*" element={<div className="container mt-5"><h2>404 - No Encontrado</h2></div>} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
