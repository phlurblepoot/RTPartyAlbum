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

// Admin API stays pending so AuthProvider remains in 'loading' state.
// RequireAdmin renders <p>Loading…</p> while status === 'loading'.
vi.mock('./admin/api', () => ({
  adminApi: {
    me: vi.fn(() => new Promise(() => {})),
    login: vi.fn(),
    logout: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import UploadPage from './pages/UploadPage';
import DisplayPage from './pages/DisplayPage';
import { AdminRoutes } from './admin/AdminRoutes';

const routes = [
  { path: '/e/:code', element: <UploadPage /> },
  { path: '/e/:code/display', element: <DisplayPage /> },
  { path: '/admin/*', element: <AdminRoutes /> },
];

function renderRouter(initialEntries: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, {
    initialEntries,
    future: { v7_relativeSplatPath: true },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </QueryClientProvider>,
  );
}

describe('router', () => {
  it('renders the UploadPage for /e/:code', () => {
    renderRouter(['/e/PARTY1']);
    expect(screen.getByTestId('upload-page')).toHaveTextContent('PARTY1');
  });

  it('renders the DisplayPage loading state for /e/:code/display', () => {
    // getPublicEvent / getPublicPhotos are mocked as pending promises above,
    // so DisplayPage renders its loading surface until the engine seeds.
    renderRouter(['/e/PARTY1/display']);
    expect(screen.getByTestId('display-loading')).toBeInTheDocument();
  });

  it('renders the Admin loading state for /admin (auth check pending)', () => {
    renderRouter(['/admin']);
    // RequireAdmin renders <p>Loading…</p> while AuthProvider checks /api/admin/me
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
