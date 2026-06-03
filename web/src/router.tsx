import { createBrowserRouter } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import { AdminRoutes } from './admin/AdminRoutes';

export const router = createBrowserRouter(
  [
    { path: '/', element: <LandingPage /> },
    { path: '/e/:code', element: <UploadPage /> },
    { path: '/e/:code/display', element: <DisplayPage /> },
    { path: '/admin/*', element: <AdminRoutes /> },
    { path: '*', element: <div>Not found</div> },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  },
);
