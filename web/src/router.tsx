import { createBrowserRouter } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import AdminApp from './admin/AdminApp';

export const router = createBrowserRouter([
  { path: '/e/:code', element: <UploadPage /> },
  { path: '/e/:code/display', element: <DisplayPage /> },
  { path: '/admin/*', element: <AdminApp /> },
  { path: '*', element: <div>Not found</div> },
]);
