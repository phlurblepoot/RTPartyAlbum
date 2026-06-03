import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import AdminApp from './admin/AdminApp';

const routes = [
  { path: '/e/:code', element: <UploadPage /> },
  { path: '/e/:code/display', element: <DisplayPage /> },
  { path: '/admin/*', element: <AdminApp /> },
];

describe('router', () => {
  it('renders the UploadPage for /e/:code', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/e/PARTY1'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('upload-page')).toHaveTextContent('PARTY1');
  });

  it('renders the DisplayPage placeholder for /e/:code/display', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/e/PARTY1/display'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('display-placeholder')).toBeInTheDocument();
  });

  it('renders the Admin placeholder for /admin', () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/admin'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('admin-placeholder')).toBeInTheDocument();
  });
});
