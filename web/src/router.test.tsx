import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// UploadPage now fetches the event via react-query; keep getPublicEvent pending
// so the smoke test exercises the real loading state (which renders the
// `upload-page` testid with the route code).
vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client');
  return {
    ...actual,
    getPublicEvent: vi.fn(() => new Promise(() => {})),
    getPublicPhotos: vi.fn(() => new Promise(() => {})),
    uploadFiles: vi.fn(),
  };
});

import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import AdminApp from './admin/AdminApp';

const routes = [
  { path: '/e/:code', element: <UploadPage /> },
  { path: '/e/:code/display', element: <DisplayPage /> },
  { path: '/admin/*', element: <AdminApp /> },
];

function renderRouter(initialEntries: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('router', () => {
  it('renders the UploadPage for /e/:code', () => {
    renderRouter(['/e/PARTY1']);
    expect(screen.getByTestId('upload-page')).toHaveTextContent('PARTY1');
  });

  it('renders the DisplayPage placeholder for /e/:code/display', () => {
    renderRouter(['/e/PARTY1/display']);
    expect(screen.getByTestId('display-placeholder')).toBeInTheDocument();
  });

  it('renders the Admin placeholder for /admin', () => {
    renderRouter(['/admin']);
    expect(screen.getByTestId('admin-placeholder')).toBeInTheDocument();
  });
});
