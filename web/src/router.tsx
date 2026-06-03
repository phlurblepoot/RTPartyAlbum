import { createBrowserRouter } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import { AdminRoutes } from './admin/AdminRoutes';

export const router = createBrowserRouter(
  [
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
